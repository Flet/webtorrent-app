/* global URL, Blob */
console.time('init')

var airplay = require('airplay-js')
var cfg = require('application-config')('WebTorrent')
var chromecasts = require('chromecasts')()
var config = require('../config')
var createTorrent = require('create-torrent')
var dragDrop = require('drag-drop')
var electron = require('electron')
var EventEmitter = require('events')
var extend = require('xtend')
var mainLoop = require('main-loop')
var networkAddress = require('network-address')
var os = require('os')
var path = require('path')
var torrentPoster = require('./lib/torrent-poster')
var WebTorrent = require('webtorrent')

var App = require('./views/app')
var createElement = require('virtual-dom/create-element')
var diff = require('virtual-dom/diff')
var patch = require('virtual-dom/patch')

var ipcRenderer = electron.ipcRenderer

var HOME = os.homedir()

// For easy debugging in Developer Tools
var state = global.state = require('./state')

// Force use of webtorrent trackers on all torrents
global.WEBTORRENT_ANNOUNCE = createTorrent.announceList
  .map(function (arr) {
    return arr[0]
  })
  .filter(function (url) {
    return url.indexOf('wss://') === 0 || url.indexOf('ws://') === 0
  })

var vdomLoop
var defaultSaved = {
  torrents: [],
  downloadPath: path.join(HOME, 'Downloads')
}

// All state lives in state.js. `state.saved` is read from and written to a file.
// All other state is ephemeral. First we load state.saved then initialize the app.
loadState(init)

/**
 * Called once when the application loads. (Not once per window.)
 * Connects to the torrent networks, sets up the UI and OS integrations like
 * the dock icon and drag+drop.
 */
function init () {
  document.querySelector('.loading').remove()

  // Connect to the WebTorrent and BitTorrent networks
  // WebTorrent.app is a hybrid client, as explained here: https://webtorrent.io/faq
  state.client = new WebTorrent()
  state.client.on('warning', onWarning)
  state.client.on('error', onError)
  state.client.on('torrent', saveTorrentData)

  // The UI is built with virtual-dom, a minimalist library extracted from React
  // The concepts--one way data flow, a pure function that renders state to a
  // virtual DOM tree, and a diff that applies changes in the vdom to the real
  // DOM, are all the same. Learn more: https://facebook.github.io/react/
  vdomLoop = mainLoop(state, render, {
    create: createElement,
    diff: diff,
    patch: patch
  })
  document.body.appendChild(vdomLoop.target)

  // Calling update() updates the UI given the current state
  // Do this at least once a second to show latest state for each torrent
  // (eg % downloaded) and to keep the cursor in sync when playing a video
  setInterval(function () {
    update()
    updateClientProgress()
  }, 1000)

  // Resume all saved torrents now that state is loaded and vdom is ready
  resumeAllTorrents()
  window.addEventListener('beforeunload', saveState)

  // listen for messages from the main process
  setupIpc()

  // OS integrations:
  // ...Chromecast and Airplay
  detectDevices()

  // ...drag and drop a torrent or video file to play or seed
  dragDrop('body', onFiles)

  // ...same thing if you paste a torrent
  document.addEventListener('paste', function () {
    ipcRenderer.send('addTorrentFromPaste')
  })

  // ...keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    if (e.which === 27) { /* ESC means either exit fullscreen or go back */
      if (state.isFullScreen) {
        dispatch('toggleFullScreen')
      } else {
        dispatch('back')
      }
    } else if (e.which === 32) {
      dispatch('playPause')
    }
  })

  // ...focus and blur. Needed to show correct dock icon text ("badge") in OSX
  window.addEventListener('focus', function () {
    state.isFocused = true
    state.dock.badge = 0
  })

  window.addEventListener('blur', function () {
    state.isFocused = false
  })

  console.timeEnd('init')
}

// This is the (mostly) pure funtion from state -> UI. Returns a virtual DOM
// tree. Any events, such as button clicks, will turn into calls to dispatch()
function render (state) {
  return App(state, dispatch)
}

// Calls render() to go from state -> UI, then applies to vdom to the real DOM.
function update () {
  vdomLoop.update(state)
  updateElectron()
}

function updateElectron () {
  if (state.title !== state.prev.title) {
    state.prev.title = state.title
    ipcRenderer.send('setTitle', state.title)
  }
  if (state.dock.progress !== state.prev.progress) {
    state.prev.progress = state.dock.progress
    ipcRenderer.send('setProgress', state.dock.progress)
  }
  if (state.dock.badge !== state.prev.badge) {
    ipcRenderer.send('setBadge', state.dock.badge || '')
  }
}

// Events from the UI never modify state directly. Instead they call dispatch()
function dispatch (action, ...args) {
  console.log('dispatch: %s %o', action, args)
  if (action === 'addTorrent') {
    addTorrent(args[0] /* torrentId */)
  }
  if (action === 'seed') {
    seed(args[0] /* files */)
  }
  if (action === 'openPlayer') {
    openPlayer(args[0] /* torrent */)
  }
  if (action === 'deleteTorrent') {
    deleteTorrent(args[0] /* torrent */)
  }
  if (action === 'openChromecast') {
    openChromecast(args[0] /* torrent */)
  }
  if (action === 'openAirplay') {
    openAirplay(args[0] /* torrent */)
  }
  if (action === 'setDimensions') {
    setDimensions(args[0] /* dimensions */)
  }
  if (action === 'back') {
    // TODO
    // window.history.back()
    closePlayer()
  }
  if (action === 'forward') {
    // TODO
    // window.history.forward()
  }
  if (action === 'playPause') {
    state.video.isPaused = !state.video.isPaused
    update()
  }
  if (action === 'playbackJump') {
    state.video.jumpToTime = args[0] /* seconds */
    update()
  }
  if (action === 'toggleFullScreen') {
    ipcRenderer.send('toggleFullScreen')
    update()
  }
  if (action === 'videoMouseMoved') {
    state.video.mouseStationarySince = new Date().getTime()
    update()
  }
}

function setupIpc () {
  ipcRenderer.on('addTorrent', function (e, torrentId) {
    dispatch('addTorrent', torrentId)
  })

  ipcRenderer.on('seed', function (e, files) {
    dispatch('seed', files)
  })

  ipcRenderer.on('fullscreenChanged', function (e, isFullScreen) {
    state.isFullScreen = isFullScreen
    update()
  })

  ipcRenderer.on('addFakeDevice', function (e, device) {
    var player = new EventEmitter()
    player.play = (networkURL) => console.log(networkURL)
    state.devices[device] = player
    update()
  })
}

function detectDevices () {
  chromecasts.on('update', function (player) {
    state.devices.chromecast = player
  })

  airplay.createBrowser().on('deviceOn', function (player) {
    state.devices.airplay = player
  }).start()
}

// Load state.saved from the JSON state file
function loadState (callback) {
  cfg.read(function (err, data) {
    if (err) console.error(err)
    ipcRenderer.send('log', 'loaded state from ' + cfg.filePath)

    // populate defaults if they're not there
    state.saved = extend(defaultSaved, data)

    if (callback) callback()
  })
}

function resumeAllTorrents () {
  state.saved.torrents.forEach((x) => startTorrenting(x.infoHash))
}

// Write state.saved to the JSON state file
function saveState () {
  ipcRenderer.send('log', 'saving state to ' + cfg.filePath)
  cfg.write(state.saved, function (err) {
    if (err) console.error(err)
    update()
  })
}

function updateClientProgress () {
  var progress = state.client.progress
  var activeTorrentsExist = state.client.torrents.some(function (torrent) {
    return torrent.progress !== 1
  })
  // Hide progress bar when client has no torrents, or progress is 100%
  if (!activeTorrentsExist || progress === 1) {
    progress = -1
  }
  state.dock.progress = progress
}

function onFiles (files) {
  // .torrent file = start downloading the torrent
  files.filter(isTorrentFile).forEach(function (torrentFile) {
    dispatch('addTorrent', torrentFile)
  })

  // everything else = seed these files
  dispatch('seed', files.filter(isNotTorrentFile))
}

function isTorrentFile (file) {
  var extname = path.extname(file.name).toLowerCase()
  return extname === '.torrent'
}

function isNotTorrentFile (file) {
  return !isTorrentFile(file)
}

// Adds a torrent to the list, starts downloading/seeding. TorrentID can be a
// magnet URI, infohash, or torrent file: https://github.com/feross/webtorrent#clientaddtorrentid-opts-function-ontorrent-torrent-
function addTorrent (torrentId) {
  if (!torrentId) torrentId = 'magnet:?xt=urn:btih:6a9759bffd5c0af65319979fb7832189f4f3c35d&dn=sintel.mp4'
  var torrent = startTorrenting(torrentId)

  // check if torrent is duplicate
  var exists = state.saved.torrents.find((x) => x.infoHash === torrent.infoHash)
  if (exists) return window.alert('That torrent is already downloading.')

  // save only if infoHash is available
  if (torrent.infoHash) {
    state.saved.torrents.push({
      infoHash: torrent.infoHash
    })
  } else {
    torrent.on('infoHash', () => saveTorrentData(torrent))
  }

  saveState()
}

// add torrent metadata to state once it's available
function saveTorrentData (torrent) {
  var ix = state.saved.torrents.findIndex((x) => x.infoHash === torrent.infoHash)
  var data = {
    name: torrent.name,
    magnetURI: torrent.magnetURI,
    infoHash: torrent.infoHash,
    path: torrent.path,
    xt: torrent.xt,
    dn: torrent.dn,
    announce: torrent.announce
  }

  if (ix === -1) state.saved.torrents.push(data)
  else state.saved.torrents[ix] = data

  saveState()
}

// Starts downloading and/or seeding a given torrent file or magnet URI
function startTorrenting (torrentId) {
  var torrent = state.client.add(torrentId, {
    // use downloads folder
    path: state.saved.downloadPath
  })
  addTorrentEvents(torrent)
  return torrent
}

// Creates a torrent for a local file and starts seeding it
function seed (files) {
  if (files.length === 0) return
  var torrent = state.client.seed(files)
  addTorrentEvents(torrent)
}

function addTorrentEvents (torrent) {
  torrent.on('infoHash', update)

  torrent.on('ready', torrentReady)
  torrent.on('done', torrentDone)

  update()

  function torrentReady () {
    torrentPoster(torrent, function (err, buf) {
      if (err) return onWarning(err)
      torrent.posterURL = URL.createObjectURL(new Blob([ buf ], { type: 'image/png' }))
      update()
    })
    update()
  }

  function torrentDone () {
    if (!state.isFocused) {
      state.dock.badge += 1
    }
    update()
  }
}

function startServer (torrent, cb) {
  if (state.server) return cb()

  // use largest file
  state.torrentPlaying = torrent.files.reduce(function (a, b) {
    return a.length > b.length ? a : b
  })
  var index = torrent.files.indexOf(state.torrentPlaying)

  var server = torrent.createServer()
  server.listen(0, function () {
    var port = server.address().port
    var urlSuffix = ':' + port + '/' + index
    state.server = {
      server: server,
      localURL: 'http://localhost' + urlSuffix,
      networkURL: 'http://' + networkAddress() + urlSuffix
    }
    cb()
  })
}

function closeServer () {
  state.server.server.destroy()
  state.server = null
}

function openPlayer (torrent) {
  startServer(torrent, function () {
    state.url = '/player'
    state.title = torrent.name
    update()
  })
}

function closePlayer () {
  state.url = '/'
  state.title = config.APP_NAME
  update()

  if (state.isFullScreen) {
    dispatch('toggleFullScreen')
  }
  restoreBounds()
  closeServer()
}

function deleteTorrent (torrent) {
  var ix = state.saved.torrents.findIndex((x) => x.infoHash === torrent.infoHash)
  if (ix > -1) state.saved.torrents.splice(ix, 1)
  torrent.destroy(saveState)
}

function openChromecast (torrent) {
  startServer(torrent, function () {
    state.devices.chromecast.play(state.server.networkURL, {
      title: config.APP_NAME + ' — ' + torrent.name
    })
    state.devices.chromecast.on('error', function (err) {
      err.message = 'Chromecast: ' + err.message
      onError(err)
    })
    update()
  })
}

function openAirplay (torrent) {
  startServer(torrent, function () {
    state.devices.airplay.play(state.server.networkURL, 0, function () {
      // TODO: handle airplay errors
    })
    update()
  })
}

// Set window dimensions to match video dimensions or fill the screen
function setDimensions (dimensions) {
  state.mainWindowBounds = {
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight
  }

  // Limit window size to screen size
  var screenWidth = window.screen.width
  var screenHeight = window.screen.height
  var aspectRatio = dimensions.width / dimensions.height
  var scaleFactor = Math.min(
    Math.min(screenWidth / dimensions.width, 1),
    Math.min(screenHeight / dimensions.height, 1)
  )
  var width = Math.floor(dimensions.width * scaleFactor)
  var height = Math.floor(dimensions.height * scaleFactor)

  // Center window on screen
  var x = Math.floor((screenWidth - width) / 2)
  var y = Math.floor((screenHeight - height) / 2)

  ipcRenderer.send('setAspectRatio', aspectRatio)
  ipcRenderer.send('setBounds', {x, y, width, height})
}

function restoreBounds () {
  ipcRenderer.send('setAspectRatio', 0)
  if (state.mainWindowBounds) {
    ipcRenderer.send('setBounds', state.mainWindowBounds, true)
  }
}

function onError (err) {
  console.error(err.stack)
  window.alert(err.message || err)
  update()
}

function onWarning (err) {
  console.log('warning: %s', err.message)
}
