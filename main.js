const TAB_PREFIX = "tab_";

function init()
{
	document.getElementById('authNewUserDialog').addEventListener('close', onAuthNewUserDialogClose);
	document.querySelector("#tab_settings > a").addEventListener('click', onTabClick);
	document.querySelector("#tab_add > a").addEventListener('click', onAddClick);
	showLoading();
	chrome.runtime.sendMessage({
		type: 'getAccountList'
	}, function (response)
	{
		console.log("response got");
		hideLoading();
		if (response.accountList.length > 0)
		{
			for (account of response.accountList)
			{
				addTab(account);
			}
			setSelectedTab(TAB_PREFIX + response.accountList[0].id);
		}
		else
		{
			document.querySelector("#tab_add > a > img").className = "pulse";
		}
	});
	
	document.getElementById('decommission').addEventListener('click', onDecommissionClick);
	document.getElementById('decommissionDialog').addEventListener('close', onDecommissionDialogClose);
	document.getElementById('saveBotConfig').addEventListener('click', onSaveBotConfigClick);
	document.getElementById('manageSources').addEventListener('click', onManageSourcesClick);
	document.getElementById('addSource').addEventListener('click', onAddSourceClick);
	document.getElementById('deleteSources').addEventListener('click', onDeleteSourcesClick);
	document.getElementById('sourceEditDialog').addEventListener('close', onSourceEditDialogClose);
	document.getElementById('manageQueue').addEventListener('click', onManageQueueClick);
	document.getElementById('addTweets').addEventListener('click', onAddTweetsClick);
	document.getElementById('deleteTweets').addEventListener('click', onDeleteTweetsClick);
	document.getElementById('tweetGeneratorDialog').addEventListener('close', onTweetGeneratorDialogClose);
}

function showLoading()
{
	document.getElementById('loadingDialog').showModal();
}

function hideLoading()
{
	document.getElementById('loadingDialog').close();
}

function onMessage(message, sender, sendResponse)
{
	switch (message.type)
	{
	}
}

function onAuthNewUserDialogClose(event)
{
	if (event.target.returnValue == 'ok')
	{
		showLoading();
		var form = document.getElementById('authNewUserForm');
		chrome.runtime.sendMessage({
			type: 'authNewUserPIN',
			token: form.elements.token.value,
			secret: form.elements.secret.value,
			pin: form.elements.pin.value
		}, function (response)
		{
			hideLoading();
			var tab = addTab(response.user);
			setSelectedTab(tab.id);
		});
	}
}

function onAddClick(event)
{
	document.getElementById('authNewUserDialog').showModal();
	chrome.runtime.sendMessage({
		type: 'beginAuthNewUser'
	}, function (response)
	{
		var form = document.getElementById('authNewUserForm');
		form.elements.token.value = response.token;
		form.elements.secret.value = response.secret;
	});
}

function addTab(userdata)
{
	var li = document.createElement('LI');
	li.id = TAB_PREFIX + userdata.id;
	li.dataset.id = userdata.id;
	li.dataset.name = userdata.name;
	li.dataset.screenName = userdata.screenName;
	var a = document.createElement('A');
	a.addEventListener('click', onTabClick);
	var img = document.createElement('IMG');
	img.src = userdata.profileImageURL;
	
	a.appendChild(img);
	li.appendChild(a);
	document.getElementById('botsNav').insertBefore(li, document.getElementById('tab_add'));
	
	return li;
}

function onTabClick(event)
{
	setSelectedTab(event.currentTarget.parentNode.id);
}

function setSelectedTab(tabId)
{
	var tab = document.querySelector(".selected");
	if (tab)
	{
		tab.className = "";
	}
	var lastSection = document.querySelector("main > section:not([hidden])");
	if (lastSection)
	{
		lastSection.hidden = true;
	}
	
	if (tabId)
	{
		tab = document.getElementById(tabId);
		tab.className = "selected";
		
		switch (tabId)
		{
			case 'tab_settings':
				document.getElementById('settings').hidden = false;
				//TODO: populate settings
				break;
			default:
				chrome.runtime.sendMessage({
					type: "getConfig",
					accountId: tab.dataset.id
				}, function (response)
				{
					document.getElementById('botId').value = tab.dataset.id;
					document.getElementById('botName').textContent = tab.dataset.name;
					document.getElementById('botScreenName').textContent = tab.dataset.screenName;
					var status = (response.config.enabled ? "Online" : "Offline");
					//TODO: give a better answer than that
					document.getElementById('botStatus').textContent = status;
					document.getElementById('botEnabled').checked = response.config.enabled;
					document.getElementById('botMinDelay').value = response.config.minDelay;
					document.getElementById('botMaxDelay').value = response.config.maxDelay;
					document.getElementById('botWarnOnEmpty').checked = response.config.warnOnEmpty;
					document.getElementById('botconfig').hidden = false;
				});
				break;
		}
	}
}

function onSaveBotConfigClick(event)
{
	//TODO: sanitize these damn things
	chrome.runtime.sendMessage({
		type: "setConfig",
		accountId: document.getElementById('botId').value,
		config: {
			enabled: document.getElementById('botEnabled').checked,
			warnOnEmpty: document.getElementById('botWarnOnEmpty').checked,
			minDelay: parseFloat(document.getElementById('botMinDelay').value),
			maxDelay: parseFloat(document.getElementById('botMaxDelay').value)
		}
	}, function (response)
	{
		//TODO: check for errors I guess??
	});
}

function onManageSourcesClick(event)
{
	var list = document.getElementById('sourceList');
	list.innerHTML = "";
	chrome.runtime.sendMessage({
		type: 'getSourceList',
		accountId: document.getElementById('botId').value
	}, function (response)
	{
		for (source of response.sourceList)
		{
			addSourceToList(source);
		}
		document.getElementById('sourceManagerDialog').showModal();
	});
}

function onAddSourceClick(event)
{
	var form = document.getElementById('sourceEditForm');
	form.elements.id.value = "";
	form.elements.name.value = "";
	form.elements.text.value = "";
	document.getElementById('sourceEditDialog').showModal();
}

function onDeleteSourcesClick(event)
{
	var list = document.getElementById('sourceList');
	var toDelete = [];
	for (var node of Array.from(list.childNodes))
	{
		if (node.querySelector("input").checked)
		{
			toDelete.push(node);
		}
	}
	
	if (toDelete.length > 0)
	{
		chrome.runtime.sendMessage({
			type: 'removeSources',
			accountId: document.getElementById('botId').value,
			sources: toDelete.map(node => parseInt(node.dataset.id))
		}, function (response)
		{
			for (var node of toDelete)
			{
				list.removeChild(node);
			}
			var smd = document.getElementById('sourceManagerDialog');
			smd.close()
			smd.showModal();
		});
	}
}

function onSourceEditDialogClose(event)
{
	if (event.target.returnValue == 'ok')
	{
		var form = document.getElementById('sourceEditForm');
		var source = {
			name: form.elements.name.value,
			text: form.elements.text.value
		};
		if (form.elements.id.value)
		{
			source.id = parseInt(form.elements.id.value);
			chrome.runtime.sendMessage({
				type: 'updateSource',
				source: source
			}, function (response)
			{
				//TODO: ???
			});
		}
		else
		{
			chrome.runtime.sendMessage({
				type: 'addSources',
				accountId: document.getElementById('botId').value,
				sources: [source]
			}, function (response)
			{
				for (var source of response.sources)
				{
					addSourceToList(source);
				}
				var smd = document.getElementById('sourceManagerDialog');
				smd.close()
				smd.showModal();
				var list = document.getElementById('sourceList');
				list.scrollIntoView(list.lastElementChild);
			});
		}
	}
}

function addSourceToList(source)
{
	var list = document.getElementById('sourceList');
	var li = document.createElement('LI');
	li.dataset.id = source.id;
	var input = document.createElement('INPUT');
	input.type = "checkbox";
	li.appendChild(input);
	var span = document.createElement('SPAN');
	span.textContent = source.name;
	li.appendChild(span);
	//TODO: edit link
	li.addEventListener('click', function (event)
	{
		var cb = event.currentTarget.querySelector("input");
		if (cb != event.target)
			cb.checked = !cb.checked;
	});
	list.appendChild(li);
}

function onManageQueueClick(event)
{
	var list = document.getElementById('tweetList');
	list.innerHTML = "";
	chrome.runtime.sendMessage({
		type: 'getQueue',
		accountId: document.getElementById('botId').value
	}, function (response)
	{
		for (tweet of response.queue)
		{
			addTweetToList(tweet);
		}
		document.getElementById('queueManagerDialog').showModal();
	});
}

function onAddTweetsClick(event)
{
	showTweetGeneratorDialog();
}

function showTweetGeneratorDialog()
{
	var list = document.getElementById('generatedTweets');
	list.innerHTML = "";
	for (var i = 0; i < 5; ++i)
	{
		chrome.runtime.sendMessage({
			type: 'generateTweet',
			accountId: document.getElementById('botId').value
		}, function (response)
		{
			addGeneratedTweetToList(response.tweet);
		});
	}
	document.getElementById('tweetGeneratorDialog').showModal();
}

function onTweetGeneratorDialogClose(event)
{
	var list = document.getElementById('generatedTweets');
	var toAdd = [];
	for (var node of Array.from(list.childNodes))
	{
		if (node.querySelector("input").checked)
		{
			toAdd.push({
				text: node.querySelector("samp").textContent
			});
		}
	}
	if (toAdd.length > 0)
	{
		chrome.runtime.sendMessage({
			type: 'addToQueue',
			accountId: document.getElementById('botId').value,
			tweets: toAdd
		}, function (response)
		{
			for (var tweet of response.tweets)
			{
				addTweetToList(tweet);
			}
		});
	}
	if (event.target.returnValue == 'continue')
	{
		showTweetGeneratorDialog();
	}
}

function onDecommissionClick(event)
{
	document.getElementById('decommissionDialog').showModal();
}

function onDecommissionDialogClose(event)
{
	if (event.target.returnValue == 'ok')
	{
		chrome.runtime.sendMessage({
			type: 'decommission',
			accountId: document.getElementById('botId').value,
		}, function (response)
		{
			if (response.success)
			{
				var tab = document.getElementById(TAB_PREFIX + response.accountId);
				tab.parentElement.removeChild(tab);
				setSelectedTab(null);
			}
		});
	}
}

function onDeleteTweetsClick(event)
{
	var list = document.getElementById('tweetList');
	var toDelete = [];
	for (var node of Array.from(list.childNodes))
	{
		if (node.querySelector("input").checked)
		{
			toDelete.push(node);
		}
	}
	
	if (toDelete.length > 0)
	{
		chrome.runtime.sendMessage({
			type: 'removeFromQueue',
			accountId: document.getElementById('botId').value,
			tweets: toDelete.map(node => parseInt(node.dataset.id))
		}, function (response)
		{
			for (var node of toDelete)
			{
				list.removeChild(node);
			}
			var qmd = document.getElementById('queueManagerDialog');
			qmd.close()
			qmd.showModal();
		});
	}
}

function addTweetToList(tweet)
{
	var list = document.getElementById('tweetList');
	var li = document.createElement('LI');
	li.dataset.id = tweet.id;
	var input = document.createElement('INPUT');
	input.type = "checkbox";
	li.appendChild(input);
	var span = document.createElement('SPAN');
	span.textContent = tweet.text;
	li.appendChild(span);
	//TODO: edit link
	li.addEventListener('click', function (event)
	{
		var cb = event.currentTarget.querySelector("input");
		if (cb != event.target)
			cb.checked = !cb.checked;
	});
	list.appendChild(li);
}
function addGeneratedTweetToList(tweet)
{
	var list = document.getElementById('generatedTweets');
	var li = document.createElement('LI');
	//TODO: fix
	var input = document.createElement('INPUT');
	input.type = "checkbox";
	li.appendChild(input);
	var samp = document.createElement('SAMP');
	samp.textContent = tweet;
	li.appendChild(samp);
	li.addEventListener('click', function (event)
	{
		var cb = event.currentTarget.querySelector("input");
		if (cb != event.target)
			cb.checked = !cb.checked;
		
	});
	list.appendChild(li);
}

chrome.runtime.onMessage.addListener(onMessage);
document.addEventListener('DOMContentLoaded', init);