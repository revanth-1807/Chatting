const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  Name: { type: String, required: true },
  Email: { type: String, required: true, unique: true },
  Password: { type: String, required: true }
}, { strict: true }); // This ignores any extra fields

module.exports = mongoose.model('Userlogin', userSchema);
