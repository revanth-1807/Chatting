const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, 'revanth');
    req.user = decoded.user;
    next();
  } catch (err) {
    console.error('JWT Error:', err.message);
    return res.redirect('/login');
  }
};
