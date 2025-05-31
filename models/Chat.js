const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'Userlogin' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'Userlogin' },
  message: String,
  timestamp: { type: Date, default: Date.now },
  // <-- New field for custom name
});

module.exports = mongoose.model('Chat', chatSchema);
