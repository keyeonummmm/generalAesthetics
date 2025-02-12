const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: {
    popup: './src/popup.tsx',
    background: './src/background.ts',
    content: './src/content.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: [
          /node_modules/,
          /\.test\.(ts|tsx)$/,
          /__tests__/
        ],
      },
      {
        test: /\.css$/,
        include: [
          path.resolve(__dirname, 'src/style'),
          path.resolve(__dirname, 'src/components')
        ],
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.css', '.test.ts', '.test.tsx'],
    modules: [
      'node_modules',
      path.resolve(__dirname, 'src/style')
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/popup.html',
      filename: 'popup.html',
      chunks: ['popup'],
    }),
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "icons", to: "icons" }
      ],
    }),
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        NODE_ENV: process.env.NODE_ENV || 'development',
        API_URL: 'http://localhost:8080',
      }),
    }),
  ],
  devtool: process.env.NODE_ENV === 'production' 
    ? false 
    : 'cheap-module-source-map',
}; 