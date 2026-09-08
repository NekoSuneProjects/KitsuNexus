const path = require('path')
const { Sequelize } = require('sequelize')

const storage = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'kitsunexus.sqlite')

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage,
  logging: false,
})

module.exports = sequelize
