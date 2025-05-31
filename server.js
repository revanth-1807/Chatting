const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const path = require('path');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const dayjs = require('dayjs');
const User = require('./models/Userlogin');
const Chat = require('./models/Chat');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MongoDB session store
const store = new MongoDBStore({
  uri: process.env.M,
  collection: 'sessions'
});
store.on('error', error => {
  console.error('Session store error:', error);
});

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  store: store,
  cookie: { maxAge: 1000 * 60 * 60, secure: false } // use secure:true with HTTPS in production
}));

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Connect to MongoDB
mongoose.connect(process.env.M)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware to protect routes
function isAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Routes

app.get('/', (req, res) => {
  res.redirect('/login');
});

// Register page
app.get('/register', (req, res) => {
  res.render('register');
});

// Login page
app.get('/login', (req, res) => {
  res.render('login');
});

// Register POST
app.post('/register', async (req, res) => {
  try {
    const { Name, Email, Password, ConfirmPassword } = req.body;

    if (Password !== ConfirmPassword) {
      return res.send('<script>alert("Passwords do not match");window.location="/register";</script>');
    }

    const existingUser = await User.findOne({ Email });
    if (existingUser) {
      return res.send('<script>alert("Email already registered");window.location="/register";</script>');
    }

    const hashedPassword = await bcrypt.hash(Password, 10);

    const newUser = new User({
      Name,
      Email,
      Password: hashedPassword
    });

    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Login POST
app.post('/login', async (req, res) => {
  try {
    const { Email, Password } = req.body;
    const user = await User.findOne({ Email });
    if (!user) {
      return res.send('<script>alert("No such user");window.location="/login";</script>');
    }

    const isMatch = await bcrypt.compare(Password, user.Password);
    if (!isMatch) {
      return res.send('<script>alert("Invalid password");window.location="/login";</script>');
    }

    // Save user in session
    req.session.user = {
      _id: user._id.toString(),
      Name: user.Name,
      Email: user.Email
    };

    res.redirect('/interface');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error(err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// Interface page: show chat partners with possible custom names
app.get('/interface', isAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user._id;
    const ObjectId = mongoose.Types.ObjectId;

    // Aggregate chat partners and get customName if set
    const chats = await Chat.aggregate([
      {
        $match: {
          $or: [
            { sender: new ObjectId(currentUserId) },
            { receiver: new ObjectId(currentUserId) }
          ]
        }
      },
      {
        $project: {
          otherUser: {
            $cond: [
              { $eq: ["$sender", new ObjectId(currentUserId)] },
              "$receiver",
              "$sender"
            ]
          },
          customName: 1
        }
      },
      {
        $group: {
          _id: "$otherUser",
          customName: { $first: "$customName" }
        }
      },
      {
        $lookup: {
          from: 'userlogins',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          _id: "$userInfo._id",
          name: "$userInfo.Name",
          email: "$userInfo.Email",
          customName: 1
        }
      }
    ]);

    res.render('interface', { chats });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error loading conversations');
  }
});

// Start chat with user by email
app.post('/start-chat', isAuth, async (req, res) => {
  try {
    const { email } = req.body;
    const otherUser = await User.findOne({ Email: email });
    if (!otherUser) {
      return res.send('<script>alert("User not found");window.location="/interface";</script>');
    }
    res.redirect(`/chat/${otherUser._id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Chatroom page - show messages between logged-in user and other user
app.get('/chat/:id', isAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user._id;
    const otherUserId = req.params.id;

    const otherUser = await User.findById(otherUserId);
    if (!otherUser) return res.status(404).send('User not found');

    const messages = await Chat.find({
      $or: [
        { sender: currentUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUserId }
      ]
    }).sort({ timestamp: 1 });

    res.render('chatroom', {
      currentUser: req.session.user,
      chatUser: otherUser,
      messages,
      dayjs
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading chatroom');
  }
});

// Route to update custom contact name


// -------- SOCKET.IO FOR REAL-TIME CHAT --------

io.on('connection', (socket) => {
  //console.log('A user connected:', socket.id);

  socket.on('joinRoom', ({ userId, otherUserId }) => {
    const roomName = [userId, otherUserId].sort().join('_');
    socket.join(roomName);
    //console.log(`Socket ${socket.id} joined room: ${roomName}`);
  });

  socket.on('chatMessage', async ({ senderId, receiverId, message }) => {
    if (!message || message.trim() === '') return;

    const newChat = new Chat({
      sender: senderId,
      receiver: receiverId,
      message: message.trim()
    });

    await newChat.save();

    const roomName = [senderId, receiverId].sort().join('_');
    io.to(roomName).emit('message', {
      sender: senderId,
      receiver: receiverId,
      message: message.trim(),
      timestamp: newChat.timestamp
    });
  });

  socket.on('disconnect', () => {
    //console.log('User disconnected:', socket.id);
  });
});

// Update custom name for a chat partner
app.post('/update-name/:chatUserId', isAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user._id;
    const chatUserId = req.params.chatUserId;
    const { customName } = req.body;

    if (!customName || customName.trim().length === 0) {
      return res.send('<script>alert("Name cannot be empty");window.history.back();</script>');
    }

    // Update or create customName in all chats between current user and chatUserId
    // We'll update all chat docs where (sender = currentUser AND receiver = chatUserId)
    // OR (sender = chatUserId AND receiver = currentUser)
    await Chat.updateMany(
      {
        $or: [
          { sender: currentUserId, receiver: chatUserId },
          { sender: chatUserId, receiver: currentUserId }
        ]
      },
      { $set: { customName: customName.trim() } }
    );

    res.redirect(`/chat/${chatUserId}`);
  } catch (err) {
    console.log('Failed to update name:', err);
    res.send('<script>alert("Failed to update name");window.history.back();</script>');
  }
});


// Start server
const PORT = process.env.PORT || 5007;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
