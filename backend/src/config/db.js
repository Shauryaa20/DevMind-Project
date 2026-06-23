const mongoose = require('mongoose');

const connectMongo = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set.');
  }

  return mongoose.connect(mongoUri);
};

module.exports = { connectMongo };
