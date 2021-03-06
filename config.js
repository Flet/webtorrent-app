var applicationConfigPath = require('application-config-path')
var path = require('path')

var APP_NAME = 'WebTorrent'
var APP_TEAM = 'The WebTorrent Project'
var APP_VERSION = require('./package.json').version

module.exports = {
  APP_COPYRIGHT: 'Copyright © 2014-2016 ' + APP_TEAM,
  APP_FILE_ICON: path.join(__dirname, 'static', 'WebTorrentFile'),
  APP_ICON: path.join(__dirname, 'static', 'WebTorrent'),
  APP_NAME: APP_NAME,
  APP_TEAM: APP_TEAM,
  APP_VERSION: APP_VERSION,

  AUTO_UPDATE_URL: 'https://webtorrent.io/app/update?version=' + APP_VERSION,
  AUTO_UPDATE_CHECK_STARTUP_DELAY: 10 * 1000 /* 10 seconds */,

  CONFIG_PATH: applicationConfigPath(APP_NAME),
  CONFIG_POSTER_PATH: path.join(applicationConfigPath(APP_NAME), 'Posters'),
  CONFIG_TORRENT_PATH: path.join(applicationConfigPath(APP_NAME), 'Torrents'),

  INDEX: 'file://' + path.join(__dirname, 'renderer', 'index.html'),

  IS_PRODUCTION: isProduction(),

  ROOT_PATH: __dirname,
  STATIC_PATH: path.join(__dirname, 'static'),

  SOUND_ADD: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'add.wav'),
    volume: 0.2
  },
  SOUND_DELETE: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'delete.wav'),
    volume: 0.1
  },
  SOUND_DISABLE: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'disable.wav'),
    volume: 0.2
  },
  SOUND_DONE: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'done.wav'),
    volume: 0.2
  },
  SOUND_ENABLE: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'enable.wav'),
    volume: 0.2
  },
  SOUND_ERROR: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'error.wav'),
    volume: 0.2
  },
  SOUND_PLAY: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'play.wav'),
    volume: 0.2
  },
  SOUND_STARTUP: {
    url: 'file://' + path.join(__dirname, 'static', 'sound', 'startup.wav'),
    volume: 0.4
  }
}

function isProduction () {
  if (!process.versions.electron) {
    return false
  }
  if (process.platform === 'darwin') {
    return !/\/Electron\.app\/Contents\/MacOS\/Electron$/.test(process.execPath)
  }
  if (process.platform === 'win32') {
    return !/\\electron\.exe$/.test(process.execPath)
  }
  if (process.platform === 'linux') {
    return !/\/electron$/.test(process.execPath)
  }
}
