// preload.js
const { ipcRenderer } = require('electron')

// contextIsolation is off (matches OSCAudiolink), so expose directly on window.
window.electronAPI = {
  // generic
  getSetting: (key, def) => ipcRenderer.invoke('getSetting', key, def),
  saveSetting: (key, value) => ipcRenderer.invoke('saveSetting', key, value),
  getOscPort: () => ipcRenderer.invoke('getOscPort'),
  updateOscPort: port => ipcRenderer.send('updateOscPort', port),
  updateOscTargets: targets => ipcRenderer.send('updateOscTargets', targets),

  // now playing / overlay
  getNowPlaying: () => ipcRenderer.invoke('getNowPlaying'),
  nowPlayingSources: () => ipcRenderer.invoke('nowPlaying:sources'),
  nowPlayingSetSource: value => ipcRenderer.invoke('nowPlaying:setSource', value),
  getOverlayState: () => ipcRenderer.invoke('getOverlayState'),
  updateOverlaySettings: s => ipcRenderer.invoke('updateOverlaySettings', s),

  // component + network stats
  statsStart: ms => ipcRenderer.invoke('stats:start', ms),
  statsStop: () => ipcRenderer.invoke('stats:stop'),
  netStart: opts => ipcRenderer.invoke('net:start', opts),
  netStop: () => ipcRenderer.invoke('net:stop'),

  // heart rate (Pulsoid, HypeRate, or generic local device bridge)
  hrStart: cfg => ipcRenderer.invoke('hr:start', cfg),
  hrStop: () => ipcRenderer.invoke('hr:stop'),
  hrSessions: () => ipcRenderer.invoke('hr:sessions'),
  hrClearSessions: () => ipcRenderer.invoke('hr:clearSessions'),
  hrPulsoidAuthorize: () => ipcRenderer.invoke('hr:pulsoidAuthorize'),
  hrPulsoidKeys: () => ipcRenderer.invoke('hr:pulsoidKeys'),
  hrBleSelect: deviceId => ipcRenderer.invoke('hr:bleSelect', deviceId),
  hrBleCancel: () => ipcRenderer.invoke('hr:bleCancel'),
  hrBlePrepareReconnect: target => ipcRenderer.send('hr:blePrepareReconnect', target),
  hrBleCached: () => ipcRenderer.invoke('hr:bleCached'),
  hrBleDebug: (eventName, details) => ipcRenderer.invoke('hr:bleDebug', eventName, details),
  hrBleOpenDebug: () => ipcRenderer.invoke('hr:bleOpenDebug'),
  hrBlePairingResponse: response => ipcRenderer.invoke('hr:blePairingResponse', response),
  hrBleReading: (bpm, measuredAt) => ipcRenderer.invoke('hr:bleReading', bpm, measuredAt),

  // NekoAvatarLocker ownership vault + VRChat OSC feature gates
  lockerGetState: () => ipcRenderer.invoke('locker:getState'),
  lockerImportOwnership: () => ipcRenderer.invoke('locker:importOwnership'),
  lockerExportOwnership: avatarId => ipcRenderer.invoke('locker:exportOwnership', avatarId),
  lockerSignOwnershipTemplate: () => ipcRenderer.invoke('locker:signOwnershipTemplate'),
  lockerSetUnlock: (avatarId, mode, groupIds) => ipcRenderer.invoke('locker:setUnlock', avatarId, mode, groupIds),
  lockerUpdateOscSettings: settings => ipcRenderer.invoke('locker:updateOscSettings', settings),
  lockerResetVault: () => ipcRenderer.invoke('locker:resetVault'),
  lockerLegacyStatus: () => ipcRenderer.invoke('locker:legacyStatus'),
  lockerImportLegacyVault: () => ipcRenderer.invoke('locker:importLegacyVault'),
  lockerOpenUserData: () => ipcRenderer.invoke('locker:openUserData'),

  // OSC companion integrations
  oscAppsRuskGet: () => ipcRenderer.invoke('oscApps:ruskGet'),
  oscAppsRuskStart: options => ipcRenderer.invoke('oscApps:ruskStart', options),
  oscAppsRuskStop: () => ipcRenderer.invoke('oscApps:ruskStop'),
  oscAppsTwitchInteractiveGet: () => ipcRenderer.invoke('oscApps:twitchInteractiveGet'),
  oscAppsTwitchInteractiveStart: options => ipcRenderer.invoke('oscApps:twitchInteractiveStart', options),
  oscAppsTwitchInteractiveStop: () => ipcRenderer.invoke('oscApps:twitchInteractiveStop'),
  oscAppsRecognizeSong: request => ipcRenderer.invoke('oscApps:recognizeSong', request),
  oscAppsRecognitionProviders: () => ipcRenderer.invoke('oscApps:recognitionProviders'),
  oscAppsCaptureSources: () => ipcRenderer.invoke('oscApps:captureSources'),
  oscAppsSelectCaptureSource: sourceId => ipcRenderer.invoke('oscApps:selectCaptureSource', sourceId),

  // window activity
  windowStart: () => ipcRenderer.invoke('window:start'),
  windowStop: () => ipcRenderer.invoke('window:stop'),

  // ToNSaveManager (Terrors of Nowhere)
  tonStart: opts => ipcRenderer.invoke('ton:start', opts),
  tonStop: () => ipcRenderer.invoke('ton:stop'),
  tonGet: () => ipcRenderer.invoke('ton:get'),
  tonOscGet: () => ipcRenderer.invoke('tonOsc:get'),
  tonOscSet: on => ipcRenderer.invoke('tonOsc:set', on),
  tonOscResync: () => ipcRenderer.invoke('tonOsc:resync'),
  tonOscRaw: () => ipcRenderer.invoke('tonOsc:raw'),
  tonHistory: limit => ipcRenderer.invoke('ton:history', limit),
  tonData: () => ipcRenderer.invoke('ton:data'),
  tonDataRefresh: () => ipcRenderer.invoke('ton:dataRefresh'),
  tonSeen: () => ipcRenderer.invoke('ton:seen'),
  tonExport: () => ipcRenderer.invoke('ton:export'),
  tonImport: () => ipcRenderer.invoke('ton:import'),
  tonUnlocks: () => ipcRenderer.invoke('ton:unlocks'),
  tonToggleUnlock: (category, key) => ipcRenderer.invoke('ton:toggleUnlock', { category, key }),
  tonSaves: () => ipcRenderer.invoke('ton:saves'),
  tonSaveCode: ts => ipcRenderer.invoke('ton:saveCode', ts),
  tonSavesClear: () => ipcRenderer.invoke('ton:savesClear'),
  tonResetAll: opts => ipcRenderer.invoke('ton:resetAll', opts),
  tonSaveImport: code => ipcRenderer.invoke('ton:saveImport', code),
  tonSaveDecode: arg => ipcRenderer.invoke('ton:saveDecode', arg),
  tonSaveDiff: arg => ipcRenderer.invoke('ton:saveDiff', arg),
  tonDecodeUnlocks: arg => ipcRenderer.invoke('ton:decodeUnlocks', arg),
  tonApplyUnlocks: arg => ipcRenderer.invoke('ton:applyUnlocks', arg),
  clipboardWrite: text => ipcRenderer.invoke('app:clipboard', text),
  openExternal: url => ipcRenderer.invoke('app:openExternal', url),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateStart: opts => ipcRenderer.invoke('update:startUpdate', opts),
  vrOverlayIsAvailable: () => ipcRenderer.invoke('vrOverlay:isAvailable'),
  vrOverlayStart: () => ipcRenderer.invoke('vrOverlay:start'),
  vrOverlayStop: () => ipcRenderer.invoke('vrOverlay:stop'),
  vrOverlayIsRunning: () => ipcRenderer.invoke('vrOverlay:isRunning'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  appContributors: () => ipcRenderer.invoke('app:contributors'),
  appSupporters: () => ipcRenderer.invoke('app:supporters'),

  // Manage the ToNSaveManager app (download/run/stop/update)
  tonMgrStatus: () => ipcRenderer.invoke('tonmgr:status'),
  tonMgrInstall: () => ipcRenderer.invoke('tonmgr:install'),
  tonMgrUpdate: () => ipcRenderer.invoke('tonmgr:update'),
  tonMgrStart: () => ipcRenderer.invoke('tonmgr:start'),
  tonMgrStop: () => ipcRenderer.invoke('tonmgr:stop'),
  tonMgrSetAuto: on => ipcRenderer.invoke('tonmgr:setAuto', on),
  tonMgrGetAuto: () => ipcRenderer.invoke('tonmgr:getAuto'),

  // ToN VR/desktop alerts
  tonNotifyGet: () => ipcRenderer.invoke('tonNotify:get'),
  tonNotifySet: cfg => ipcRenderer.invoke('tonNotify:set', cfg),
  tonNotifyTest: () => ipcRenderer.invoke('tonNotify:test'),
  tonNotifyDetect: () => ipcRenderer.invoke('tonNotify:detect'),

  // tiktok
  tiktokConnect: (user, signApiKey) => ipcRenderer.invoke('tiktok:connect', { username: user, signApiKey }),
  tiktokDisconnect: () => ipcRenderer.invoke('tiktok:disconnect'),
  tiktokFollowersStart: user => ipcRenderer.invoke('tiktok:followers:start', user),
  tiktokFollowersStop: () => ipcRenderer.invoke('tiktok:followers:stop'),
  tiktokVoices: () => ipcRenderer.invoke('tiktok:voices'),
  tiktokTts: (text, voice) => ipcRenderer.invoke('tiktok:tts', { text, voice }),

  // twitch
  twitchStart: cfg => ipcRenderer.invoke('twitch:start', cfg),
  twitchStop: () => ipcRenderer.invoke('twitch:stop'),

  // kick
  kickStart: slug => ipcRenderer.invoke('kick:start', slug),
  kickStop: () => ipcRenderer.invoke('kick:stop'),

  // shared OAuth providers
  oauthTwitchLogin: (clientId, clientSecret, scopes) => ipcRenderer.invoke('oauth:twitchLogin', { clientId, clientSecret, scopes }),
  oauthTwitchRedirect: () => ipcRenderer.invoke('oauth:twitchRedirect'),

  // ai
  aiRewrite: opts => ipcRenderer.invoke('ai:rewrite', opts),
  aiProviders: () => ipcRenderer.invoke('ai:providers'),

  // avatar scaling hotkeys (global keyboard hook lives in main)
  avatarScalingRecordKey: () => ipcRenderer.invoke('avatarScaling:recordKey'),
  avatarScalingSetHotkeys: keys => ipcRenderer.invoke('avatarScaling:setHotkeys', keys),
  avatarScalingClearHotkeys: () => ipcRenderer.invoke('avatarScaling:clearHotkeys'),

  // translator
  translate: opts => ipcRenderer.invoke('translate:run', opts),
  translateProviders: () => ipcRenderer.invoke('translate:providers'),

  // i18n
  i18nLanguages: () => ipcRenderer.invoke('i18n:languages'),
  i18nStrings: lang => ipcRenderer.invoke('i18n:strings', lang),

  // text-to-speech
  ttsSpeak: opts => ipcRenderer.invoke('tts:speak', opts),
  ttsProviders: () => ipcRenderer.invoke('tts:providers'),
  ttsSapiVoices: () => ipcRenderer.invoke('tts:sapiVoices'),

  // speech-to-text
  sttTranscribeCloud: opts => ipcRenderer.invoke('stt:transcribeCloud', opts),
  sttTranscribeLocal: opts => ipcRenderer.invoke('stt:transcribeLocal', opts),
  sttCloudProviders: () => ipcRenderer.invoke('stt:cloudProviders'),
  sttLocalModels: () => ipcRenderer.invoke('stt:localModels'),

  // voice assistant
  assistantInterpret: opts => ipcRenderer.invoke('assistant:interpret', opts),
  assistantSaveClip: opts => ipcRenderer.invoke('assistant:saveClip', opts),
  assistantSummarizeSearch: opts => ipcRenderer.invoke('assistant:summarizeSearch', opts),
  assistantSearchWeb: opts => ipcRenderer.invoke('assistant:searchWeb', opts),

  // discord
  discordStart: cfg => ipcRenderer.invoke('discord:start', cfg),
  discordStop: () => ipcRenderer.invoke('discord:stop'),
  discordActivity: a => ipcRenderer.invoke('discord:activity', a),
  discordVrc: ctx => ipcRenderer.invoke('discord:vrc', ctx),
  discordLive: ctx => ipcRenderer.invoke('discord:live', ctx),

  // discord identity login (official bot + Activity status push)
  discordIdentityLogin: () => ipcRenderer.invoke('oauth:discordLogin'),
  discordIdentityLogout: () => ipcRenderer.invoke('oauth:discordLogout'),
  discordIdentityStatus: () => ipcRenderer.invoke('oauth:discordLoginStatus'),

  // vrchat world
  vrcGet: () => ipcRenderer.invoke('vrc:get'),

  // vrchat account (auto status)
  vrchatLogin: (username, password) => ipcRenderer.invoke('vrchat:login', { username, password }),
  vrchatVerify2fa: (code, method) => ipcRenderer.invoke('vrchat:verify2fa', { code, method }),
  vrchatStatus: () => ipcRenderer.invoke('vrchat:status'),
  vrchatIsLoggedIn: () => ipcRenderer.invoke('vrchat:isLoggedIn'),
  vrchatLogout: () => ipcRenderer.invoke('vrchat:logout'),
  vrchatAutoStatus: on => ipcRenderer.invoke('vrchat:autostatus', on),
  vrchatFriends: () => ipcRenderer.invoke('vrchat:friends'),
  vrchatAllFriends: () => ipcRenderer.invoke('vrchat:allFriends'),
  vrchatGroups: () => ipcRenderer.invoke('vrchat:groups'),
  vrchatGroupEvents: groupId => ipcRenderer.invoke('vrchat:groupEvents', groupId),
  vrchatNotifications: () => ipcRenderer.invoke('vrchat:notifications'),
  vrchatAcceptFriend: id => ipcRenderer.invoke('vrchat:acceptFriend', id),
  vrchatUser: id => ipcRenderer.invoke('vrchat:user', id),
  vrchatFriendRequest: id => ipcRenderer.invoke('vrchat:friendRequest', id),
  vrchatRequestInvite: (id, slot) => ipcRenderer.invoke('vrchat:requestInvite', { id, slot }),
  vrchatUnfriend: id => ipcRenderer.invoke('vrchat:unfriend', id),
  vrchatInvite: (id, instanceId, slot) => ipcRenderer.invoke('vrchat:invite', { id, instanceId, slot }),
  vrchatUserGroups: id => ipcRenderer.invoke('vrchat:userGroups', id),
  vrchatUserWorlds: id => ipcRenderer.invoke('vrchat:userWorlds', id),
  vrchatMutuals: id => ipcRenderer.invoke('vrchat:mutuals', id),
  vrchatFavWorlds: () => ipcRenderer.invoke('vrchat:favWorlds'),
  vrchatFavGroups: type => ipcRenderer.invoke('vrchat:favGroups', type),
  vrchatBoop: (id, emojiId) => ipcRenderer.invoke('vrchat:boop', { id, emojiId }),
  vrchatMyAvatars: () => ipcRenderer.invoke('vrchat:myAvatars'),
  vrchatMyWorlds: () => ipcRenderer.invoke('vrchat:myWorlds'),
  vrchatAddFav: (type, id) => ipcRenderer.invoke('vrchat:addFav', { type, id }),
  vrchatRemoveFav: id => ipcRenderer.invoke('vrchat:removeFav', id),
  vrchatSearchUsers: q => ipcRenderer.invoke('vrchat:searchUsers', q),
  vrchatSearchWorlds: q => ipcRenderer.invoke('vrchat:searchWorlds', q),
  vrchatSearchGroups: q => ipcRenderer.invoke('vrchat:searchGroups', q),
  vrchatWorld: id => ipcRenderer.invoke('vrchat:world', id),
  vrchatWorldName: id => ipcRenderer.invoke('vrchat:worldName', id),
  vrchatGroup: id => ipcRenderer.invoke('vrchat:group', id),
  vrchatUpdateProfile: fields => ipcRenderer.invoke('vrchat:updateProfile', fields),
  vrchatSelectAvatar: id => ipcRenderer.invoke('vrchat:selectAvatar', id),
  vrchatDeleteAvatar: id => ipcRenderer.invoke('vrchat:deleteAvatar', id),
  vrchatCreateInstance: (worldId, access, region) => ipcRenderer.invoke('vrchat:createInstance', { worldId, access, region }),
  vrchatInviteSelf: location => ipcRenderer.invoke('vrchat:inviteSelf', location),
  vrchatCreateGroupInstance: (worldId, groupId, access, region) => ipcRenderer.invoke('vrchat:createGroupInstance', { worldId, groupId, access, region }),
  vrchatGroupInvite: (groupId, userId) => ipcRenderer.invoke('vrchat:groupInvite', { groupId, userId }),
  vrchatSetNote: (userId, note) => ipcRenderer.invoke('vrchat:setNote', { userId, note }),
  vrchatModerate: (userId, type) => ipcRenderer.invoke('vrchat:moderate', { userId, type }),
  vrchatUnmoderate: (userId, type) => ipcRenderer.invoke('vrchat:unmoderate', { userId, type }),
  vrchatFavFriendIds: () => ipcRenderer.invoke('vrchat:favFriendIds'),
  vrchatMessages: type => ipcRenderer.invoke('vrchat:messages', type),
  vrchatUpdateMessage: (type, slot, message) => ipcRenderer.invoke('vrchat:updateMessage', { type, slot, message }),
  vrchatGroupGalleries: id => ipcRenderer.invoke('vrchat:groupGalleries', id),
  vrchatGroupGalleryImages: (groupId, galleryId) => ipcRenderer.invoke('vrchat:groupGalleryImages', { groupId, galleryId }),
  vrchatGroupPosts: id => ipcRenderer.invoke('vrchat:groupPosts', id),
  vrchatAvatar: id => ipcRenderer.invoke('vrchat:avatar', id),
  vrchatGroupMembers: id => ipcRenderer.invoke('vrchat:groupMembers', id),
  vrchatGroupRoles: id => ipcRenderer.invoke('vrchat:groupRoles', id),
  vrchatModerations: () => ipcRenderer.invoke('vrchat:moderations'),
  vrchatInventory: tag => ipcRenderer.invoke('vrchat:inventory', tag),
  vrchatPrints: () => ipcRenderer.invoke('vrchat:prints'),
  vrchatImage: url => ipcRenderer.invoke('vrchat:image', url),
  avatarsSearch: (url, query, page) => ipcRenderer.invoke('avatars:search', { url, query, page }),
  avatarsDefaultProviders: () => ipcRenderer.invoke('avatars:defaultProviders'),
  setAutoRejoin: on => ipcRenderer.invoke('app:setAutoRejoin', on),
  pawprintsList: () => ipcRenderer.invoke('pawprints:list'),
  pawprintsClear: () => ipcRenderer.invoke('pawprints:clear'),

  // history / game-log
  historyList: opts => ipcRenderer.invoke('history:list', opts),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historyLog: ev => ipcRenderer.invoke('history:log', ev),
  historyImportVrcx: p => ipcRenderer.invoke('history:importVrcx', p),

  // notifications (cached)
  notifList: () => ipcRenderer.invoke('notif:list'),
  notifDismiss: id => ipcRenderer.invoke('notif:dismiss', id),
  notifAccept: id => ipcRenderer.invoke('notif:accept', id),
  notifClear: () => ipcRenderer.invoke('notif:clear'),
  notifUnreadCount: () => ipcRenderer.invoke('notif:unreadCount'),
  notifMarkAllRead: () => ipcRenderer.invoke('notif:markAllRead'),

  // auto-greeter
  greeterSet: cfg => ipcRenderer.invoke('greeter:set', cfg),

  // photo relay
  photoRelaySet: cfg => ipcRenderer.invoke('photoRelay:set', cfg),
  screenshotMetadataSet: enabled => ipcRenderer.invoke('screenshotMetadata:set', enabled),
  launchVRChat: () => ipcRenderer.invoke('app:launchVRChat'),
  mediaPhotos: () => ipcRenderer.invoke('media:photos'),
  mediaOpen: p => ipcRenderer.invoke('media:open', p),
  vrchatOnline: () => ipcRenderer.invoke('vrchat:online'),
  vrchatNews: () => ipcRenderer.invoke('vrchat:news'),
  appsLaunch: (paths, withVrchat) => ipcRenderer.invoke('apps:launch', { paths, withVrchat }),
  quickLaunchResolveExe: () => ipcRenderer.invoke('quickLaunch:resolveExe'),
  quickLaunchBrowseExe: () => ipcRenderer.invoke('quickLaunch:browseExe'),
  quickLaunchLaunch: (profile, instanceInfo) => ipcRenderer.invoke('quickLaunch:launch', { profile, instanceInfo }),
  quickLaunchLaunchAll: (profiles, instanceInfo) => ipcRenderer.invoke('quickLaunch:launchAll', { profiles, instanceInfo }),
  dataExport: () => ipcRenderer.invoke('data:export'),
  dataImport: () => ipcRenderer.invoke('data:import'),

  // weather
  weatherStart: opts => ipcRenderer.invoke('weather:start', opts),
  weatherStop: () => ipcRenderer.invoke('weather:stop'),
  weatherGet: () => ipcRenderer.invoke('weather:get'),

  // discord bot (voice + DiscordOSC)
  botStart: cfg => ipcRenderer.invoke('bot:start', cfg),
  botStop: () => ipcRenderer.invoke('bot:stop'),
  botSetMute: m => ipcRenderer.invoke('bot:setMute', m),
  botSetDeaf: d => ipcRenderer.invoke('bot:setDeaf', d),
  botInvite: appId => ipcRenderer.invoke('bot:invite', appId),

  // discord bot — official KitsuNexus bot mode (no token, backend-backed)
  officialBotStart: () => ipcRenderer.invoke('bot:startOfficial'),
  officialBotStop: () => ipcRenderer.invoke('bot:stopOfficial'),
  officialBotSetMute: m => ipcRenderer.invoke('bot:setMuteOfficial', m),
  officialBotSetDeaf: d => ipcRenderer.invoke('bot:setDeafOfficial', d),
  getNekosuneBackendUrl: () => ipcRenderer.invoke('nekosune:getBackendUrl'),

  // soundpad
  soundpadCmd: (action, index) => ipcRenderer.invoke('soundpad:cmd', { action, index }),
  soundpadList: () => ipcRenderer.invoke('soundpad:list'),

  // media keys (SpotiOSC)
  mediaKey: action => ipcRenderer.invoke('media:key', action),

  // vrchat maintenance tools
  vrcToolsYtDlp: () => ipcRenderer.invoke('vrctools:ytdlp'),
  vrcToolsCacheSize: () => ipcRenderer.invoke('vrctools:cacheSize'),
  vrcToolsClearCache: () => ipcRenderer.invoke('vrctools:clearCache'),
  vrcToolsOpenFolder: which => ipcRenderer.invoke('vrctools:openFolder', which),
  vvcInstall: () => ipcRenderer.invoke('vrctools:vvcInstall'),
  vvcStart: () => ipcRenderer.invoke('vrctools:vvcStart'),
  vvcStop: () => ipcRenderer.invoke('vrctools:vvcStop'),
  vvcStatus: () => ipcRenderer.invoke('vrctools:vvcStatus'),

  // startup / auto-launch
  setLaunchOnLogin: enabled => ipcRenderer.invoke('app:setLaunchOnLogin', enabled),
  getLaunchOnLogin: () => ipcRenderer.invoke('app:getLaunchOnLogin'),

  // auto-afk
  afkStart: opts => ipcRenderer.invoke('afk:start', opts),
  afkStop: () => ipcRenderer.invoke('afk:stop'),

  // vr
  vrStart: () => ipcRenderer.invoke('vr:start'),
  vrStop: () => ipcRenderer.invoke('vr:stop'),

  // community ranks (KitsuNexus OG ranks — Veteran/Legend, opt-in)
  ranksConfig: () => ipcRenderer.invoke('ranks:config'),
  ranksEstimate: (tags, dateJoined) => ipcRenderer.invoke('ranks:estimate', { tags, dateJoined }),
  ranksSetConfig: cfg => ipcRenderer.invoke('ranks:setConfig', cfg),
  ranksGet: () => ipcRenderer.invoke('ranks:get'),
  ranksRefresh: () => ipcRenderer.invoke('ranks:refresh'),
  ranksLeaderboard: limit => ipcRenderer.invoke('ranks:leaderboard', limit),
  ranksContribution: payload => ipcRenderer.invoke('ranks:contribution', payload),
  ranksHistory: () => ipcRenderer.invoke('ranks:history'),

  // event subscription (main -> renderer)
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
}
