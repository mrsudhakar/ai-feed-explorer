document.getElementById('timeFilter').addEventListener('change', () => {
  if (window.feedData) renderFeeds(window.feedData);
});

window.addEventListener('DOMContentLoaded', () => {
  loadOPML('feedlist.opml');
});

async function loadOPML(file) {
  setStatus("Loading feeds...");
  try {
    const opmlText = await fetch(file).then(r => r.text());
    parseOPML(opmlText);
  } catch {
    setStatus("No OPML file found. Please upload one.");
  }
}

async function parseOPML(opmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(opmlText, "text/xml");
  const outlines = xmlDoc.querySelectorAll("outline[type='rss']");

  const feeds = Array.from(outlines).map(o => ({
    title: o.getAttribute("title"),
    url: o.getAttribute("xmlUrl")
  }));

  window.feedData = [];
  let loadedCount = 0;

  for (let feed of feeds) {
    fetchFeed(feed.url, feed.title)
      .then(items => {
        window.feedData = window.feedData.concat(items);
        loadedCount++;
        setStatus(`Loaded ${loadedCount}/${feeds.length} feeds...`);
        renderFeeds(window.feedData);
      })
      .catch(err => {
        loadedCount++;
        console.error(`Error fetching ${feed.url}`, err);
        setStatus(`Loaded ${loadedCount}/${feeds.length} feeds...`);
      });
  }
}

async function fetchFeed(url, source) {
  const proxy = "https://api.allorigins.win/raw?url=";
  const res = await fetch(proxy + encodeURIComponent(url));
  if (!res.ok) throw new Error("Failed to fetch feed");
  const text = await res.text();
  return parseRSS(text, source);
}

function parseRSS(xmlString, sourceTitle) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlString, "text/xml");
  const items = xml.querySelectorAll("item");
  return Array.from(items).map(item => ({
    title: item.querySelector("title")?.textContent || "No title",
    link: item.querySelector("link")?.textContent || "#",
    pubDate: new Date(item.querySelector("pubDate")?.textContent || Date.now()),
    source: sourceTitle
  }));
}

function renderFeeds(items) {
  const hoursLimit = parseInt(document.getElementById('timeFilter').value, 10);
  const cutoff = new Date(Date.now() - hoursLimit * 60 * 60 * 1000);
  
  const container = document.getElementById('feedContainer');
  container.innerHTML = "";

  const filtered = items
    .filter(item => item.pubDate >= cutoff)
    .sort((a, b) => b.pubDate - a.pubDate);

  if (filtered.length === 0) {
    setStatus(`No news in last ${hoursLimit} hours`);
    return;
  }

  setStatus(`Showing ${filtered.length} items from last ${hoursLimit} hours`);

  filtered.forEach(item => {
    const el = document.createElement('div');
    el.className = "feed-item";
    el.innerHTML = `
      <h3><a href="${item.link}" target="_blank">${item.title}</a></h3>
      <time>${item.pubDate.toLocaleString()} | ${item.source}</time>
    `;
    container.appendChild(el);
  });
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}
