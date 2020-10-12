/*
Use this file in your web app to issue commands to the Chrome extension's API.

NOTE: Update the CHROME_EXTENSION_ID constant with your extension's ID.
*/

/** The ID of the Chrome extension to interface with. You need to set this. */
const CHROME_EXTENSION_ID = 'YOUR_EXTENSION_ID';

/** Provides proxy methods for interfacing with the extension to fetch your D&D Beyond content. */
const dndBeyond = {
  /**
   * Gets a promise containing the version number of the extension. This is mostly useful as a way
   * to detect if the extension is running.
   */
  getVersion: function() {return dndBeyond.__makeCall(arguments);},

  /** Searches D&D Beyond for any monsters that match the query. */
  searchMonsters: function(query, sources) {return dndBeyond.__makeCall(arguments);},

  /** Gets D&D Beyond data for the player or monster at the specified URL. */
  getMonsterFromUrl: function(url) {return dndBeyond.__makeCall(arguments);},

  /** Gets D&D Beyond data for the monsters in the encounter at the specified URL. */
  getMonstersFromEncounterUrl: function(url) {return dndBeyond.__makeCall(arguments);},

  /**
   * Attempts to discover what homebrew content has been created and what
   * licensed content has been purchased so that search results include as much
   * *usable* content as possible.
   */
  discoverContent: function() {return dndBeyond.__makeCall(arguments);},

  /** Determines if the source book at the specified URL is available for use. */
  isSourcePurchased: function(url) {return dndBeyond.__makeCall(arguments);},

  /** Proxies a call to the Chrome extension using the Chrome runtime API. */
  __makeCall: function(args) {
    const message = {'method': args.callee.name, 'arguments': []};

    // If initialization failed and we receive a call, throw an error.
    if (message.method !== 'getVersion' && dndBeyond.disabled) {
      throw new Error('D&D Beyond integration disabled because Chrome extension is not installed.');
    }

    // If Chrome runtime API is not present, we can't do anything.
    if (!window.chrome || !window.chrome.runtime || !window.runtime.sendMessage) {
      return Promise.resolve(undefined);
    }

    // Otherwise, build the message to send to the extension.
    for (let i = 0; i < args.length; i++) {
      message.arguments.push(args[i]);
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(CHROME_EXTENSION_ID, message, resolve);
    });
  }
};

// Before using any functionality, initialize everything.
dndBeyond.getVersion().then(version => {
  if (!version) {
    dndBeyond.disabled = true;
    console.log('Chrome extension not installed! D&D Beyond integration will be disabled.');
  } else {
    dndBeyond.disabled = undefined;
    console.log(`Extension v${version} installed! D&D Beyond integration enabled.`);
    console.log('Discovering sources...');
    dndBeyond.discoverContent().then((content) => {
      console.log('D&D Beyond sources discovered:', content.sources);
      console.log('D&D Beyond homebrew discovered:', content.homebrew);
      dndBeyond.sources = content.sources;
      dndBeyond.homebrewContent = content.homebrew;
    });
  }
});
