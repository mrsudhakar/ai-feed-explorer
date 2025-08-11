document.getElementById('opmlFile').addEventListener('change', handleFileUpload);
document.getElementById('timeFilter').addEventListener('change', () => {
  if (window.feedData) renderFeeds(window.feedData);
});

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(event) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(event.target.result, "text/xml");
    const outlines = xmlDoc.querySelectorAll("outline[type='rss']");

    const feeds = [];
    outlines.forEach(outline => {
      feeds.push({
        title: outline.getAttribute("title"),
        url: outline.getAttribute("xmlUrl")
      });
    });

    // Fetch all feeds
    let allItems = [];
    for (let feed of feeds) {
      try {
        const rssText = await fetchFeed(feed.url);
        const items = parseRSS(rssText, feed.title);
        allItems = allItems.concat(items);
      } catch (err) {
        console.error("Error fetching", feed.url, err);
      }
    }

    window.feedData = allItems;
    renderFeeds(allItems);
  };
  reader.readAsText(file);
}

async function fetchFeed(url) {
  // Use CORS proxy for browser fetch
  const proxy = "https://api.allorigins.win/raw?url=";
  const res = await fetch(proxy + encodeURIComponent(url));
  if (!res.ok) throw new Error("Failed to fetch feed");
  return await res.text();
}

function parseRSS(xmlString, sourceTitle) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlString, "text/xml");
  const items = xml.querySelectorAll("item");
  const result = [];

  items.forEach(item => {
    result.push({
      title: item.querySelector("title")?.textContent || "No title",
      link: item.querySelector("link")?.textContent || "#",
      pubDate: new Date(item.querySelector("pubDate")?.textContent || Date.now()),
      source: sourceTitle
    });
  });

  return result;
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
    container.innerHTML = "<p>No items in this time range.</p>";
    return;
  }

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
