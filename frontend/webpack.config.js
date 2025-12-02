const HtmlWebpackPlugin = require('html-webpack-plugin');
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const path = require('path');

const isDevelopment = process.env.REACT_APP_ENV === 'dev';
const isProduction = process.env.REACT_APP_ENV === 'prod';

// Determine publicPath based on environment
// Use environment variable if set, otherwise use relative path for deployments or localhost for dev server
const getPublicPath = () => {
  // If PUBLIC_URL is set (e.g., from CI/CD), use it
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.endsWith('/') ? process.env.PUBLIC_URL : `${process.env.PUBLIC_URL}/`;
  }
  // Check if webpack-dev-server is actually running (actual local development)
  // WEBPACK_SERVE is set to true by webpack-dev-server when running
  const isLocalDevServer = process.env.WEBPACK_SERVE === 'true';

  if (isLocalDevServer) {
    // Only use localhost when actually running the local dev server
    return 'http://localhost:3001/';
  }

  // For all builds (production or dev deployment), use relative path './'
  // This allows chunks to load relative to remoteEntry.mjs location
  // When deployed to dev/prod, chunks will resolve from the host URL where remoteEntry.mjs is served
  return './';
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

