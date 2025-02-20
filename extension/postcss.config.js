module.exports = {
  plugins: [
    require('postcss-prefixer')({
      prefix: 'ga-'
    }),
    require('autoprefixer'),
    require('cssnano')({
      preset: 'default'
    })
  ]
}; 