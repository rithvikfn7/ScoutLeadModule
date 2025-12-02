const HtmlWebpackPlugin = require('html-webpack-plugin');
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const path = require('path');

const isDevelopment = process.env.NODE_ENV !== 'dev';
const isProduction = process.env.NODE_ENV === 'prod';

// Determine publicPath based on environment
// Use environment variable if set, otherwise use relative path for production or localhost for dev server
const getPublicPath = () => {
  // If PUBLIC_URL is set (e.g., from CI/CD), use it
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.endsWith('/') ? process.env.PUBLIC_URL : `${process.env.PUBLIC_URL}/`;
  }
  // For production builds, use empty string which makes webpack use __webpack_public_path__ if set
  // If __webpack_public_path__ is not set, it will resolve relative to the script location
  // The host app sets __webpack_public_path__ before loading remoteEntry.mjs
  if (isDevelopment || isProduction) {
    return '';
  }
  // For local development server, use localhost
  return 'http://localhost:3001/';
};

module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: isProduction ? '[name].[contenthash].js' : '[name].js',
    publicPath: getPublicPath(),
    clean: true,
  },
  devServer: {
    port: 3001,
    hot: true,
    liveReload: true,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    client: {
      overlay: true,
    },
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          presets: ['@babel/preset-react'],
          plugins: isDevelopment ? [require.resolve('react-refresh/babel')] : [],
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg|ico)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'leads-module',
      filename: 'remoteEntry.mjs',
      library: {
        type: 'global',
        name: 'leads-module',
      },
      exposes: {
        './App': './src/App',
        './LeadsetsDashboard': './src/pages/LeadsetsDashboard',
        './LeadsetDetail': './src/pages/LeadsetDetail',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
        'react-router-dom': {
          singleton: true,
          requiredVersion: '^7.9.6',
        },
      },
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
    ...(isDevelopment ? [new ReactRefreshWebpackPlugin({
      overlay: false,
    })] : []),
  ],
};

