/*
This script implements all the dark magic that the Chrome extension uses to read
your content from D&D Beyond pages. You don't need to modify anything in this
file unless you're adding/modifying functionality for the library.

For your web app, you need to modify and use the dndbeyond.js proxy script.
*/

const BACKGROUND_URL_PATTERN = /^url\((['"]?)(.*)\1\)$/;
const CHALLENGE_RATING_PATTERN = /(\d+)\/?(\d*)/;
const CHALLENGE_RATING_AND_XP_PATTERN = /(\d+)\/?(\d*)\s*\(([0-9,]+)\s+XP\)/;
const DICE_PATTERN = /(\d+\b)?(\s\()?(\d+)?(\s*d\s*)?(\d+)?(\s*\+\s*(\d+))?/; ///((\d+)\s\()?(\d+)\s*d\s*(\d+)(\s*\+\s*(\d+))?/;
const MONSTER_TYPE_DESCRIPTION_PATTERN = /(\w+)\s(\w+)(\s\(([^)]+)\))?,\s(\w+(\s\w+)?)/;

const PLAYER_CHARACTER_URL_PATTERN = /^https:\/\/www\.dndbeyond\.com\/profile\/[^\/]+\/characters\/[^\/]+$/;
const PLAYER_CHARACTER_URL_JSON_SUFFIX = '/json';

const DND_BEYOND_BASE_URL = 'https://www.dndbeyond.com';

function ajaxGet(url) {
  return new Promise((resolve, reject) => {
    return $.get(url).done(resolve).fail(reject);
  });
}

function tryParseFloat(text) {
  return text ? parseFloat(text.replace(/\s/g, '')) : undefined;
}

function formatTextValue(text) {
  if (!text) {
    return undefined;
  }
  const trimmed = String(text).trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.replace(/\s+/g, ' ');
}

function formatTitleCase(stringValue) {
  return stringValue.replace(/\w+/g, text => text.charAt(0).toUpperCase() + text.substr(1).toLowerCase());
}

function getBackgroundImageUrl(elem) {
  const matches = BACKGROUND_URL_PATTERN.exec($(elem).css('background-image'));
  return matches ? matches[2] : undefined;
}

function parseChallengeRating(stringValue) {
  const matches = CHALLENGE_RATING_PATTERN.exec(stringValue);
  if (!matches || !matches[1]) {
    return undefined;
  }
  let value = parseFloat(matches[1]);
  if (matches[2]) {
    value /= parseFloat(matches[2]);
  }
  return value;
}

function parseChallengeRatingAndXp(stringValue) {
  const matches = CHALLENGE_RATING_AND_XP_PATTERN.exec(stringValue);
  if (!matches || !matches[1]) {
    return undefined;
  }
  let value = {stringValue: matches[1], floatValue: parseFloat(matches[1])};
  if (matches[2]) {
    value.stringValue += '/' + matches[2];
    value.floatValue /= parseFloat(matches[2]);
  }
  if (matches[3]) {
    value.xp = parseFloat(matches[3].replace(/,/g, ''));
  }
  return value;
}

function parseMonsterTypes(stringValue) {
  const matches = MONSTER_TYPE_DESCRIPTION_PATTERN.exec(stringValue);
  if (!matches || !matches[1]) {
    return undefined;
  }
  let value = {size: formatTitleCase(matches[1])};
  if (matches[2]) {
    value.type = formatTitleCase(matches[2]);
  }
  if (matches[4]) {
    value.subtype = formatTitleCase(matches[4]);
  }
  if (matches[5]) {
    value.alignment = formatTitleCase(matches[5]);
  }
  return value;
}

function normalizeDndBeyondUrl(url) {
  if (!url) {
    return undefined;
  }
  if (url.indexOf(':') >= 0) {
    return url;
  }
  let normalized = DND_BEYOND_BASE_URL;
  if (url[0] !== '/') {
    normalized += '/';
  }
  return normalized + url;
}

class DndBeyond {
  static getVersion() {
    return new Promise((resolve) => {
      resolve(chrome.runtime.getManifest().version);
    });
  }
  
  static searchMonsters(query, sources) {
    let url = 'https://www.dndbeyond.com/monsters?filter-type=0';
    const searchSources = sources || DndBeyond.discoveredSources;
    const homebrew = DndBeyond.discoveredHomebrew || [];
    if (searchSources && searchSources.length > 0) {
      for (let i = 0; i < searchSources.length; i++) {
        if (searchSources[i].purchased) {
          url += '&filter-source=' + searchSources[i].id;
        }
      }
    } else {
      url += '&filter-source=1';
    }
    url += '&filter-search=' + encodeURIComponent(query);
    return ajaxGet(url)
      .then(
      (response) => {
        const $response = $(response);
        let $resultListItems = $response.find('.listing-container .listing-body');
        let results = [];
        const queryLowerCase = query.toLowerCase();
        for (let i = 0; i < homebrew.length; i++) {
          const creation = homebrew[i];
          for (let property in creation) {
            if (!creation.hasOwnProperty(property)) {continue;}
            if (creation[property] && creation[property].toString().toLowerCase().indexOf(queryLowerCase) !== -1) {
              results.push(creation);
            }
          }
        }
        $resultListItems.find('.info').each(function() {
          let $row = $(this);
          let monster = new Monster();
          monster.name = formatTextValue($row.find('.monster-name .name').text());
          monster.source = formatTextValue($row.find('.monster-name .source').text());
          monster.challengeRatingString = formatTextValue($row.find('.monster-challenge').text());
          monster.challengeRating = parseChallengeRating(monster.challengeRatingString);
          monster.type = formatTextValue($row.find('.monster-type .type').text());
          monster.subtype = formatTextValue($row.find('.monster-type .subtype').text());
          monster.size = formatTextValue($row.find('.monster-size').text());
          monster.alignment = formatTextValue($row.find('.monster-alignment').text());
          monster.environment = formatTextValue($row.find('.monster-environment span').attr('title'));
          monster.avatarIconUrl = normalizeDndBeyondUrl(getBackgroundImageUrl($row.find('.monster-icon .image')));
          monster.largeImageUrl = normalizeDndBeyondUrl($row.find('.monster-icon a').attr('href'));
          monster.detailsPageUrl = normalizeDndBeyondUrl($row.find('a.link').attr('href'));
          results.push(monster);
        });
        return results;
      });
  }

  static getMonstersFromEncounterUrl(url) {
    return ajaxGet(url)
      .then(
        (response) => {
          const $response = $(response);
          const $monsters = $response.find('.encounter-details__body-main .encounter-monster');
          const encounter = [];
          for (let i = 0; i < $monsters.length; i++) {
            const $row = $($monsters.get(i));
            const monster = new Monster();
            monster.name = formatTextValue($row.find('.encounter-monster__details .encounter-monster__name').text());

            const subtext = formatTextValue($row.find('.encounter-monster__details .encounter-monster__subtext').text());
            const sizeAndTypeCaptures = /(\S+)\s+(\S+)/.exec(subtext);
            monster.size = sizeAndTypeCaptures[1];
            monster.type = sizeAndTypeCaptures[2];

            monster.challengeRatingString = formatTextValue($row.find('.encounter-monster__difficulty .difficulty__value').first().text());
            monster.challengeRating = parseChallengeRating(monster.challengeRatingString);
            monster.avatarIconUrl = normalizeDndBeyondUrl($row.find('.encounter-monster__avatar img').attr('src'));
            monster.detailsPageUrl = normalizeDndBeyondUrl($row.find('a').attr('href'));

            let quantityString = formatTextValue($row.find('.encounter-monster__quantity').text());
            const quantity = tryParseFloat(quantityString.substr(1)) || 1;
            encounter.push({'monster': monster, 'quantity': quantity});
          }
          return encounter;
        });
  }
  
  static getMonsterFromUrl(url) {
    if (PLAYER_CHARACTER_URL_PATTERN.test(url)) {
      return ajaxGet(url + PLAYER_CHARACTER_URL_JSON_SUFFIX)
        .then(
        (response) => {
          const monster = new Monster();
          monster.name = response.character.name;
          monster.source = 'Player Character';
          monster.hp = new Dice(response.character.baseHitPoints);

          monster.challengeRating = 0;
          for (let i = 0; i < response.character.classes; i++) {
            monster.challengeRating += response.character.classes[i].level;
          }

          monster.xp = response.character.currentXp;
          monster.type = response.character.race.baseName;
          monster.subtype = response.character.race.fullName;
          monster.size = response.character.race.size;

          monster.largeImageUrl = response.character.avatarUrl || response.character.frameAvatarUrl;
          monster.avatarIconUrl = response.character.frameAvatarUrl || response.character.avatarUrl;
          monster.detailsPageUrl = url;

          if (response.character.themeColor) {
            monster.themeColor = response.character.themeColor.themeColor;
          }

          return monster;
        });
    }
    return ajaxGet(url)
      .then(
      (response) => {
        const $response = $(response);
        const $content = $response.find('#content');
        const monster = new Monster();
        monster.name = formatTextValue($content.find('.mon-stat-block__name').text() || $response.find('h1.page-title').text());
        monster.source = formatTextValue($content.find('.source.monster-source').text());
        
        const hpDiceString = $content.find('.mon-stat-block__attribute-label:contains("Hit Points")')
                             .parent().find('.mon-stat-block__attribute-data').text();
        if (hpDiceString) {
          monster.hp = new Dice(hpDiceString);
        } else {
          monster.hp = new Dice('1');
        }

        const challenge = parseChallengeRatingAndXp($content.find('.mon-stat-block__tidbit-label:contains("Challenge")')
                                                  .parent().find('.mon-stat-block__tidbit-data').text());
        if (challenge) {
          monster.challengeRatingString = challenge.stringValue;
          monster.challengeRating = challenge.floatValue;
          monster.xp = challenge.xp;
        }
        
        const types = parseMonsterTypes($content.find('.mon-stat-block__header .mon-stat-block__meta').text());
        if (types) {
          monster.type = types.type;
          monster.subtype = types.subtype;
          monster.size = types.size;
          monster.alignment = types.alignment;
        }

        monster.environment = $content.find('.environment-tags .environment-tag').map(function() {return formatTextValue($(this).text());}).get().join(', ');

        // avatarIconUrl is not present :(
        monster.largeImageUrl = normalizeDndBeyondUrl($content.find('.detail-content .image a').attr('href'));
        monster.detailsPageUrl = url;
        return monster;
      });
  }
  
  static discoverContent() {
    let discoveryPromises = [];
    let discoveredContent = {};
    discoveryPromises.push(DndBeyond.discoverSources().then((content) => {discoveredContent.sources = content;}));
    discoveryPromises.push(DndBeyond.discoverHomebrew().then((content) => {discoveredContent.homebrew = content;}));
    return Promise.all(discoveryPromises).then(() => {
      return discoveredContent;
    });
  }
  
  static discoverSources() {
    return ajaxGet('https://www.dndbeyond.com/monsters').then(response => {
      const sourcePromises = [];
      $(response).find('#filter-source option').each((index, item) => {
        let source = new Source();
        source.id = item.value;
        source.name = $(item).text().trim();
        sourcePromises.push(DndBeyond.isSourcePurchased(source));
      });
      const allPromises = Promise.all(sourcePromises);
      allPromises.then((sources) => {
        DndBeyond.discoveredSources = sources;
      });
      return allPromises;
    });
  }
  
  static discoverHomebrew() {
    return ajaxGet('https://www.dndbeyond.com/my-collection').then(response => {
      const $response = $(response);
      let $resultListItems = $response.find('.listing-container .listing-body');
      let results = [];
      $resultListItems.find('.list-row').each(function() {
        let $row = $(this);
        let monster = new Monster();
        monster.name = formatTextValue($row.find('.list-row-name-primary-text').text());
        monster.source = formatTextValue($row.find('.list-row-name-secondary-text').text());
        monster.detailsPageUrl = normalizeDndBeyondUrl($row.find('.list-row-name-primary-text a.link').attr('href'));
        results.push(monster);
      });
      DndBeyond.discoveredHomebrew = results;
      return results;
    });
  }
  
  static isSourcePurchased(source) {
    if (source.id.toString() === '1') {
      // Basic rules are free for everyone, and the lookup will probably fail.
      source.purchased = true;
      return Promise.resolve(source);
    }
    // // This doesn't seem to work any more... not sure it's worth fixing...
    // return ajaxGet('https://www.dndbeyond.com/marketplace/source/' + source.id)
    //   .catch(error => {
    //     source.purchased = false;
    //     return source;
    //   }).then((response) => {
    //     source.purchased = $(response).find('.ddb-market-license-item-details .ddb-market-license-item-cost .content-unlocked').length > 0;
    //     return source;
    //   }
    // );
    source.purchased = true;
    return Promise.resolve(source);
  }
}

class Source {
  id = undefined;
  name = undefined;
  purchased = undefined;
}

class Monster {
  name = undefined;
  source = undefined;
  challengeRating = undefined;
  challengeRatingString = undefined;
  type = undefined;
  subtype = undefined;
  size = undefined;
  alignment = undefined;
  environment = undefined;
  avatarIconUrl = undefined;
  largeImageUrl = undefined;
  detailsPageUrl = undefined;

  hp = undefined;
  xp = undefined;

  themeColor = undefined;
}

class Dice {
  count = undefined;
  sides = undefined;
  bonus = undefined;
  defaultValue = undefined;
  minValue = undefined;
  maxValue = undefined;
  randomValue = undefined;

  constructor(stringValue) {
    let matches = DICE_PATTERN.exec(formatTextValue(stringValue));
    this.count = tryParseFloat(matches[3]);
    this.sides = tryParseFloat(matches[5]);
    this.bonus = tryParseFloat(matches[6]);
    this.defaultValue = tryParseFloat(matches[1]);
    this.randomValue = this.roll();
    if (!this.count || !this.sides) {
      this.minValue = 0;
      this.maxValue = 0;
      if (!this.bonus && this.defaultValue) {
        this.bonus = this.defaultValue;
      }
    } else {
      this.minValue = this.count * 1;
      this.maxValue = this.count * this.sides;
    }
    if (this.bonus) {
      this.minValue += this.bonus;
      this.maxValue += this.bonus;
    }
  }

  roll(multiplier, maxed) {
    let total = 0;
    if (!this.count || !this.sides) {
      for (let i = 0; i < this.count; i++) {
        total += maxed ? this.sides : Math.floor(Math.random() * this.sides + 1);
      }
    }
    if (multiplier) {
      total *= multiplier;
    }
    return total + this.bonus;
  }
}

chrome.runtime.onMessageExternal.addListener(
  function(request, sender, sendResponse) {
    let method = DndBeyond[request.method];
    method.apply(window, request.arguments).then(sendResponse);
  }
);
