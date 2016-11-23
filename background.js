//Insert API key here
const API_KEY = "APIKEY";
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

var DEFAULT_CONFIG = {
	enabled: false,
	warnOnEmpty: false,
	minDelay: 2.5,
	maxDelay: 3
}

var cb = new Codebird();
cb.setConsumerKey(API_KEY, getSecret());

function Resource()
{
	this.waitingList = [];
}

Resource.prototype = {
	_ready: false,
	get ready()
	{
		return this._ready;
	},
	set ready(value)
	{
		this._ready = value;
		if (value)
		{
			for (fn of this.waitingList)
			{
				fn();
			}
			this.waitingList = [];
		}
	},
	wait: function (fn)
	{
		if (this._ready)
		{
			fn();
		}
		else
		{
			this.waitingList.push(fn);
		}
	}
}

var resources = {
	database: new Resource()
};

var db, dbrequest = indexedDB.open("main", 1);

dbrequest.onerror = function (event)
{
	//TODO: error
};

dbrequest.onsuccess = function (event)
{
	db = event.target.result;
	resources.database.ready = true;
};

dbrequest.onupgradeneeded = function (event)
{
	console.log("Upgrading database");
	db = event.target.result;
	
	var accounts = db.createObjectStore("accounts", {keyPath: "user.id"});
	accounts.createIndex("screenName", "user.screenName", {unique: true});
	
	var tweets = db.createObjectStore("tweets", {keyPath: "id", autoIncrement: true});
	tweets.createIndex("accountId", "accountId", {unique: false});
	
	var sources = db.createObjectStore("sources", {keyPath: "id", autoIncrement: true});
	sources.createIndex("accountId", "accountId", {unique: false});
};

function onAlarm(alarm)
{
	resources.database.wait(function ()
	{
		console.log("Alarm triggered.")
		var accounts = db.transaction(["accounts", "tweets"], "readwrite").objectStore("accounts");
		accounts.get(alarm.name).onsuccess = function (event)
		{
			var account = event.target.result;
			console.log("Account loaded:" + account.user.screenName)
			var tweets = accounts.transaction.objectStore("tweets");
			var queueRequest = tweets.index("accountId").get(account.user.id);
			queueRequest.onsuccess = function (event)
			{
				console.log("Queue request completed")
				if (event.target.result)
				{
					console.log("Tweeting from queue: " + event.target.result.text)
					tweet(account, event.target.result.text, function (reply, rate, err)
					{
						if (err)
						{
							//TODO: //Error handling
						}
						else
						{
							db.transaction("tweets", "readwrite").objectStore("tweets").delete(event.target.result.id);
						}
					});
				}
				else
				{
					makeTweet(account, function (text)
					{
						console.log("Generated tweet: " + text)
						tweet(account, text);
					});
				}
			};
			account.lastTweet = Date.now();
			account.nextTweet = getNextTime(account);
			chrome.alarms.create(account.user.id, {when: account.nextTweet});
			accounts.put(account);
			//TODO: alert when queue runs out (if applicable)
		};
	});
}

function init()
{
	resources.database.wait(function ()
	{
		var accounts = db.transaction("accounts").objectStore("accounts");
		accounts.openCursor().onsuccess = function (event)
		{
			var cursor = event.target.result;
			if (cursor)
			{
				var account = cursor.value;
				if (account.config.enabled)
				{
					if (!account.nextTweet)
					{
						account.nextTweet = getNextTime(account);
					}
					chrome.alarms.create(account.user.id, {when: account.nextTweet});
					//TODO: alert when queue is empty (if applicable)
				}
				cursor.continue();
			}
		}
	});
}

function onMessage(message, sender, sendResponse)
{
	console.log(message);
	resources.database.wait(function ()
	{
		switch (message.type)
		{
			case 'beginAuthNewUser':
				cb.__call("oauth_requestToken", {oauth_callback: 'oob'}, function (reply, rate, err)
				{
					if (err)
					{
						console.log("oauth_requestToken: error response or timeout exceeded" + err.error);
						sendResponse({
							success: false,
							step: "oauth_requestToken",
							error: err.error
						});
					}
					if (reply)
					{
						sendResponse({
							success: true,
							token: reply.oauth_token,
							secret: reply.oauth_token_secret
						});
						cb.setToken(reply.oauth_token, reply.oauth_token_secret);
						
						cb.__call("oauth_authorize", {}, function (auth_url)
						{
							window.open(auth_url + "&force_login=1");
						});
					}
				});
				break;
			case 'authNewUserPIN':
				console.log("Authorizing new user using PIN");
				cb.setToken(message.token, message.secret);
				cb.__call("oauth_accessToken", {oauth_verifier: message.pin}, function (reply, rate, err)
				{
					if (err)
					{
						console.log("oauth_accessToken: error response or timeout exceeded" + err.error);
						sendResponse({
							success: false,
							step: "oauth_accessToken",
							error: err.error
						});
					}
					if (reply)
					{
						console.log("Authorization successful. Fetching userdata...")
						var requestToken = reply.oauth_token;
						var requestSecret = reply.oauth_token_secret;
						cb.setToken(requestToken, requestSecret);
						
						cb.__call("account_verifyCredentials", {skip_status: 1}, function (reply, rate, err)
						{
							if (err)
							{
								console.log("account_verifyCredentials: error response or timeout exceeded" + err.error);
								sendResponse({
									success: false,
									step: "account_verifyCredentials",
									error: err.error
								});
							}
							if (reply)
							{
								console.log("Userdata fetched.")
								var account = {
									user: {
										id: reply.id_str,
										name: reply.name,
										profileImageURL: reply.profile_image_url,
										screenName: reply.screen_name
									},
									auth: {
										token: requestToken,
										secret: requestSecret
									},
									config: DEFAULT_CONFIG
								};
								var request = db.transaction("accounts", 'readwrite').objectStore("accounts").add(account);
								request.onsuccess = function (event)
								{
									sendResponse({
										success: true,
										user: account.user
									});
								};
							}
						});
					}
				});
				break;
			case "decommission":
				var accounts = db.transaction(["accounts", "sources", "tweets"], "readwrite").objectStore("accounts");
				accounts.delete(message.accountId);
				var sources = accounts.transaction.objectStore("sources");
				sources.index("accountId").openCursor(IDBKeyRange.only(message.accountId)).onsuccess = function (event)
				{
					var cursor = event.target.result;
					if (cursor)
					{
						cursor.delete();
						cursor.continue();
					}
				};
				var tweets = accounts.transaction.objectStore("tweets");
				tweets.index("accountId").openCursor(IDBKeyRange.only(message.accountId)).onsuccess = function (event)
				{
					var cursor = event.target.result;
					if (cursor)
					{
						cursor.delete();
						cursor.continue();
					}
				};
				accounts.transaction.oncomplete = function (event) {
					sendResponse({
						success: true,
						accountId: message.accountId
					});
				};
				break;
			case "getAccountList":
				var accountList = [];
				var accounts = db.transaction("accounts").objectStore("accounts");
				accounts.openCursor().onsuccess = function (event)
				{
					var cursor = event.target.result;
					if (cursor)
					{
						accountList.push(cursor.value.user);
						cursor.continue();
					}
					else
					{
						sendResponse({
							success: true,
							accountList: accountList
						});
					}
				};
				break;
			case "getSourceList":
				var sourceList = [];
				var sources = db.transaction("sources").objectStore("sources");
				sources.index("accountId").openCursor(IDBKeyRange.only(message.accountId)).onsuccess = function (event)
				{
					var cursor = event.target.result;
					if (cursor)
					{
						sourceList.push({
							id: cursor.value.id,
							name: cursor.value.name
						});
						cursor.continue();
					}
					else
					{
						sendResponse({
							success: true,
							sourceList: sourceList
						});
					}
				};
				break;
			case "getQueue":
				var queue = [];
				var tweets = db.transaction("tweets").objectStore("tweets");
				tweets.index("accountId").openCursor(IDBKeyRange.only(message.accountId)).onsuccess = function (event)
				{
					var cursor = event.target.result;
					if (cursor)
					{
						queue.push({
							id: cursor.value.id,
							text: cursor.value.text
						});
						cursor.continue();
					}
					else
					{
						sendResponse({
							success: true,
							queue: queue
						});
					}
				};
				break;
			case "addSources":
				var addedSources = [];
				var accounts = db.transaction(["accounts", "sources"], "readwrite").objectStore("accounts");
				accounts.get(message.accountId).onsuccess = function (event)
				{
					var account = event.target.result;
					account.totalSourceSize = (account.totalSourceSize || 0);
					var sources = accounts.transaction.objectStore("sources");
					for (var item of message.sources)
					{
						(function (source)
						{
							account.totalSourceSize += source.text.length;
							sources.add({
								accountId: message.accountId,
								name: source.name,
								size: source.text.length,
								text: source.text
							}).onsuccess = function (event)
							{
								addedSources.push({
									id: event.target.result,
									name: source.name
								});
							};
						})(item);
					}
					sources.transaction.oncomplete = function (event)
					{
						db.transaction("accounts", "readwrite").objectStore("accounts").put(account).onsuccess = function (event)
						{
							sendResponse({
								success: true,
								sources: addedSources
							});
						};
					};
				};
				break;
			case "removeSources":
				var accounts = db.transaction(["accounts", "sources"], "readwrite").objectStore("accounts");
				accounts.get(message.accountId).onsuccess = function (event)
				{
					var account = event.target.result;
					//TODO: verify that all given sources actually belong to this account
					var sources = accounts.transaction.objectStore("sources");
					for (var id of message.sources)
					{
						sources.get(id).onsuccess = function (event)
						{
							account.totalSourceSize -= event.target.result.size;
							sources.delete(id);
						}
					}
					sources.transaction.oncomplete = function (event)
					{
						db.transaction("accounts", "readwrite").objectStore("accounts").put(account).onsuccess = function (event)
						{
							sendResponse({
								success: true
							});
						};
					}
				};
				break;
			case "updateSource":
				var sources = db.transaction(["accounts", "sources"], "readwrite").objectStore("sources");
				sources.get(message.source.id).onsuccess = function (event)
				{
					var oldSource = event.target.result;
					var sizeDifference = message.source.text.length - oldSource.size;
					oldSource.name = message.source.name;
					oldSource.text = message.source.text;
					oldSource.size = message.source.text.length;
					sources.put(oldSource).onsuccess = function (event)
					{
						var accounts = sources.transaction.objectStore("accounts");
						accounts.get(oldSource.accountId).onsuccess = function (event)
						{
							var account = event.target.result;
							account.totalSourceSize += sizeDifference;
							accounts.put(account).onsuccess = function (event)
							{
								sendResponse({
									success: true
								});
							};
						};
					};
				};
				break;
			case "addToQueue":
				var addedTweets = [];
				var tweets = db.transaction("tweets", "readwrite").objectStore("tweets");
				for (var tweet of message.tweets)
				{
					(function (tweet)
					{
						tweets.add({
							accountId: message.accountId,
							text: tweet.text
						}).onsuccess = function (event)
						{
							addedTweets.push({
								id: event.target.result,
								text: tweet.text
							});
						};
					})(tweet);
				}
				tweets.transaction.oncomplete = function (event)
				{
					sendResponse({
						success: true,
						tweets: addedTweets
					});
				};
				break;
			case "removeFromQueue":
				var tweets = db.transaction("tweets", "readwrite").objectStore("tweets");
				//TODO: verify that all given tweets actually belong to this account
				for (var id of message.tweets)
				{
					tweets.delete(id);
				}
				tweets.transaction.oncomplete = function (event)
				{
					sendResponse({
						success: true
					})
				};
				break;
			case "getConfig":
				var accounts = db.transaction("accounts").objectStore("accounts");
				accounts.get(message.accountId).onsuccess = function (event)
				{
					sendResponse({
						success: true,
						config: event.target.result.config
					});
				};
				break;
			case "setConfig":
				var accounts = db.transaction("accounts", "readwrite").objectStore("accounts");
				accounts.get(message.accountId).onsuccess = function (event)
				{
					var account = event.target.result;
					account.config = message.config;
					if (account.config.enabled)
					{
						if (!account.nextTweet || (account.nextTweet - (account.lastTweet || 0)) / HOUR_IN_MILLISECONDS > account.config.maxDelay)
						{
							account.nextTweet = getNextTime(account);
						}
						chrome.alarms.create(account.user.id, {when: account.nextTweet});
						//TODO: alert when queue is empty (if applicable)?
					}
					else
					{
						chrome.alarms.clear(account.user.id);
					}
					accounts.put(account).onsuccess = function (event)
					{
						sendResponse({
							success: true
						})
					};
				};
				break;
			case "generateTweet":
				var accounts = db.transaction("accounts").objectStore("accounts");
				accounts.get(message.accountId).onsuccess = function (event)
				{
					makeTweet(event.target.result, function (tweet)
					{
						sendResponse({
							success: true,
							tweet: tweet
						});
					});
				};
				break;
			default:
				console.log("received unknown message");
				sendResponse({
					success: false,
					error: "what"
				});
		}
	});
	return true;
}

function tweet(account, text, callback)
{
	cb.setToken(account.auth.token, account.auth.secret);
	cb.__call("statuses_update", {status: text}, function (reply, rate, err)
	{
		if (callback)
			callback(reply, rate, err);
	});
}

function makeTweet(account, callback)
{
	var pos = randInt(account.totalSourceSize);
	var sources = db.transaction("sources").objectStore("sources");
	sources.index("accountId").openCursor(IDBKeyRange.only(account.user.id)).onsuccess = function (event)
	{
		var cursor = event.target.result;
		if (cursor)
		{
			source = cursor.value;
			if (pos < source.size)
			{
				callback(ebooksify(source.text));
			}
			else
			{
				pos -= source.size;
				cursor.continue();
			}
		}
		else
		{
			callback("I AM ERROR");
		}
	};
}

function getNextTime(account)
{
	if (account.lastTweet)
	{
		return account.lastTweet + (Math.random() * (account.config.maxDelay - account.config.minDelay) + account.config.minDelay) * HOUR_IN_MILLISECONDS;
	}
	else
	{
		return Date.now();
	}
}

function ebooksify(sourceText)
{
	var SANITIZE_FROM = ["'", "\u2018", "\u2019", "\u201C", "\u201D"];
	var SANITIZE_TO   = [" ", " ", " ", "\"", "\""];
	var SANITIZE_REGEX = /[\'\u2018\u2019\u201C\u201D]/g;
	var ENTITY_FROM = ["&", "\"", "<", ">"];
	var ENTITY_TO   = ["amp", "quot", "lt", "gt"];
	var ENTITY_REGEX = /[&\"<>]/g;
	var WHITESPACE = " \t\n";
	const ENTITY_GAG_CHANCE = 0.05;
	
	//First, punch out a section
	var pos = randInt(sourceText.length);
	//TODO: This could probably be weighted somehow
	var len = Math.floor(Math.pow(Math.random(), 2) * 140) + 1;
	var beginIndex = Math.max(pos - Math.floor(len / 2), 0);
	var endIndex = Math.min(pos + Math.ceil(len / 2), sourceText.length);
	
	function isws(chr)
	{
		return WHITESPACE.includes(chr);
	}
	
	while (!(beginIndex == 0 || !isws(sourceText[beginIndex - 1]))) --beginIndex;
	while (!(beginIndex == 0 || isws(sourceText[beginIndex - 1]))) --beginIndex;
	while (!(endIndex == sourceText.length || !isws(sourceText[endIndex]))) ++endIndex;
	while (!(endIndex == sourceText.length || isws(sourceText[endIndex]))) ++endIndex;
	
	//cut
	var tweet = sourceText.substring(beginIndex, endIndex);
	//sanitize
	tweet = tweet.replace(/\s+/g, " ").trim();
	tweet = tweet.replace(SANITIZE_REGEX, function (str)
	{
		return SANITIZE_TO[SANITIZE_FROM.indexOf(str)];
	});
	
	if (tweet.length > 140)
		tweet = tweet.substr(0, 140);
	
	return tweet;
}

function randInt(limit)
{
	return Math.floor(Math.random() * limit);
}

chrome.alarms.onAlarm.addListener(onAlarm);
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onMessage.addListener(onMessage);