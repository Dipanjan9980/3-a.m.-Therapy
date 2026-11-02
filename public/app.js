
/* Music Hub frontend player.
   Includes swipe-right-to-Play-Next for search and liked-song rows. */


const state = {
  queue: [],
  index: -1,
  // Counts tracks inserted immediately after the current track.
  pendingNextCount: 0,
  liked: JSON.parse(localStorage.getItem("musicHubLiked") || "[]"),
  shuffle: false,
  repeat: false,
  currentPage: "home"
};

const $ = selector => document.querySelector(selector);

const audio = $("#audio");
const statusEl = $("#status");
const progress = $("#progress");
const currentTimeEl = $("#currentTime");
const durationEl = $("#duration");
const playerArt = $("#playerArt");
const playerTitle = $("#playerTitle");
const playerArtist = $("#playerArtist");
const playPause = $("#playPause");
const likeCurrent = $("#likeCurrent");
const searchInput = $("#searchInput");

const placeholder =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">
          <rect width="100%" height="100%" fill="#292929"/>
          <text x="50%" y="50%" fill="#777" font-size="70"
            text-anchor="middle" dominant-baseline="middle">♪</text>
        </svg>
      `);

window.trendingTracks = [];
window.undergroundTracks = [];
window.searchTracks = [];

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function time(seconds) {
  seconds = Math.floor(Number(seconds) || 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function liked(id) {
  return state.liked.some(track => track.id === id);
}

function saveLiked() {
  localStorage.setItem("musicHubLiked", JSON.stringify(state.liked));
}

function toggleLike(track) {
  if (!track) return;

  if (liked(track.id)) {
    state.liked = state.liked.filter(item => item.id !== track.id);
  } else {
    state.liked.push(track);
  }

  saveLiked();
  updateLikeButton();
  renderLiked();

  document
    .querySelectorAll("[data-like-id]")
    .forEach(button => {
      if (button.dataset.likeId === String(track.id)) {
        button.classList.toggle("liked", liked(track.id));
        button.textContent = liked(track.id) ? "♥" : "♡";
      }
    });
}

function updateLikeButton() {
  const track = state.queue[state.index];

  if (!track) {
    likeCurrent.textContent = "♡";
    likeCurrent.classList.remove("liked");
    return;
  }

  const isLiked = liked(track.id);
  likeCurrent.textContent = isLiked ? "♥" : "♡";
  likeCurrent.classList.toggle("liked", isLiked);
}

function card(track, index, listName) {
  return `
        <article class="card">
          <div class="cover-wrap">
            <img
              class="cover"
              src="${esc(track.artwork || placeholder)}"
              alt=""
              onerror="this.src='${placeholder}'"
            >
            <button
              class="card-play"
              data-play-list="${esc(listName)}"
              data-play-index="${index}"
              aria-label="Play"
            >▶</button>
          </div>
    
          <div class="track-title" title="${esc(track.title)}">
            ${esc(track.title)}
          </div>
          <div class="track-artist" title="${esc(track.artist)}">
            ${esc(track.artist)}
          </div>
        </article>
      `;
}

function renderCards(element, tracks, listName) {
  if (!element) return;

  if (!tracks.length) {
    element.innerHTML = `<div class="empty">No tracks found.</div>`;
    return;
  }

  element.innerHTML = tracks
    .map((track, index) => card(track, index, listName))
    .join("");

  element.querySelectorAll("[data-play-list]").forEach(button => {
    button.addEventListener("click", () => {
      const list =
        button.dataset.playList === "trending"
          ? window.trendingTracks
          : window.undergroundTracks;

      playQueue(list, Number(button.dataset.playIndex));
    });
  });
}

function row(track, index, listName) {
  return `
        <div class="result-row"
          data-row-list="${esc(listName)}"
          data-row-index="${index}"
          aria-label="${esc(track.title)} by ${esc(track.artist)}">
          <img
            class="row-art"
            src="${esc(track.artwork || placeholder)}"
            alt=""
            onerror="this.src='${placeholder}'"
          >
    
          <div class="row-main">
            <div class="row-title">${esc(track.title)}</div>
            <div class="row-artist">${esc(track.artist)}</div>
          </div>
    
          <div class="row-genre">${esc(track.genre || "Other")}</div>
          <div class="row-duration">${time(track.duration)}</div>
    
          <button
            class="like ${liked(track.id) ? "liked" : ""}"
            data-like-id="${esc(track.id)}"
            aria-label="Toggle like"
          >${liked(track.id) ? "♥" : "♡"}</button>
        </div>
      `;
}

function renderRows(element, tracks, listName) {
  if (!element) return;

  if (!tracks.length) {
    element.innerHTML = `<div class="empty">Nothing here yet.</div>`;
    return;
  }

  element.innerHTML = tracks
    .map((track, index) => row(track, index, listName))
    .join("");

  // Like buttons
  element.querySelectorAll("[data-like-id]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const list =
        button.closest(".result-row")?.dataset.rowList === "liked"
          ? state.liked
          : window.searchTracks;
      const index = Number(button.closest(".result-row")?.dataset.rowIndex);

      toggleLike(list[index]);
    });
  });

  // Double-click / double-tap a row to play it normally.
  // Single tap / click a row to play the selected song.
  element.querySelectorAll(".result-row").forEach(rowElement => {
    rowElement.addEventListener("click", event => {
      if (event.target.closest("button")) return;

      // Prevent a swipe gesture from accidentally playing the song.
      if (handledSwipe) {
        handledSwipe = false;
        return;
      }

      const list = rowElement.dataset.rowList === "liked"
        ? state.liked
        : window.searchTracks;

      const index = Number(rowElement.dataset.rowIndex);

      if (!list[index]) return;

      playQueue(list, index);
    });

    // Keep your existing swipe-to-Play-Next code below.
    // Swipe right to add this track to Play Next.
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let handledSwipe = false;

    rowElement.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      startX = event.clientX;
      startY = event.clientY;
      tracking = true;
      handledSwipe = false;
    });

    rowElement.addEventListener("pointerup", event => {
      if (!tracking) return;
      tracking = false;

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      // Ignore vertical scrolling and short accidental movements.
      if (deltaX < 75 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

      const list = rowElement.dataset.rowList === "liked"
        ? state.liked
        : window.searchTracks;
      const track = list[Number(rowElement.dataset.rowIndex)];

      if (!track) return;

      handledSwipe = true;
      addToPlayNext(track);
      rowElement.classList.remove("swipe-next");
      // Restart the short confirmation animation on repeated swipes.
      void rowElement.offsetWidth;
      rowElement.classList.add("swipe-next");

      window.setTimeout(() => {
        rowElement.classList.remove("swipe-next");
      }, 650);
    });

    rowElement.addEventListener("pointercancel", () => {
      tracking = false;
    });
  });
}

function playQueue(queue, index) {
  if (!queue?.length || !queue[index]) return;

  state.queue = [...queue];
  state.index = index;
  state.pendingNextCount = 0;

  loadCurrent();
}

async function loadCurrent(autoplay = true) {
  const track = state.queue[state.index];
  if (!track) return;

  playerTitle.textContent = track.title || "Unknown track";
  playerArtist.textContent = track.artist || "Unknown artist";
  playerArt.src = track.artwork || placeholder;

  currentTimeEl.textContent = "0:00";
  durationEl.textContent = time(track.duration);
  progress.value = 0;

  updateLikeButton();

  // IMPORTANT: Check for a playable URL before using the audio player.
  if (!track.streamUrl) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    playPause.textContent = "▶";
    statusEl.textContent =
      "Song details loaded, but no playable audio source is available.";
    return;
  }

  audio.src = track.streamUrl;
  audio.load();

  if (!autoplay) {
    statusEl.textContent = `Ready to play: ${track.title}`;
    return;
  }

  try {
    await audio.play();
    playPause.textContent = "❚❚";
    statusEl.textContent = `Playing ${track.title}`;
  } catch (error) {
    console.error("Playback failed:", error);
    playPause.textContent = "▶";
    statusEl.textContent =
      "Playback failed. The audio source may be unavailable or blocked.";
  }
}


function addToPlayNext(track) {
  if (!track) return;

  // If no song is currently playing, add it to the queue
  // without automatically starting playback.
  if (
    state.index < 0 ||
    !state.queue ||
    !state.queue[state.index]
  ) {
    state.queue = [track];
    state.index = -1;
    state.pendingNextCount = 1;

    statusEl.textContent = `Added "${track.title}" to the queue`;
    return;
  }

  // Insert after the currently playing song and all
  // previously queued Play Next songs.
  const insertAt =
    state.index + 1 + (state.pendingNextCount || 0);

  state.queue.splice(insertAt, 0, track);
  state.pendingNextCount = (state.pendingNextCount || 0) + 1;

  statusEl.textContent = `Added "${track.title}" to Play Next`;
}


function nextTrack() {
  if (!state.queue.length) return;

  // Play Next tracks take priority over repeat and shuffle.
  if (state.pendingNextCount > 0) {
    state.index += 1;
    state.pendingNextCount -= 1;
    loadCurrent();
    return;
  }

  if (state.repeat) {
    if (audio.src) {
      audio.currentTime = 0;
      audio.play().catch(error => {
        console.error("Replay failed:", error);
        statusEl.textContent = "Unable to replay this track.";
      });
    } else {
      loadCurrent();
    }
    return;
  }

  let nextIndex;

  if (state.shuffle) {
    nextIndex = Math.floor(Math.random() * state.queue.length);
  } else {
    nextIndex = state.index + 1;
    if (nextIndex >= state.queue.length) nextIndex = 0;
  }

  state.index = nextIndex;
  loadCurrent();
}

function previousTrack() {
  if (!state.queue.length) return;

  if (audio.src && audio.currentTime > 5) {
    audio.currentTime = 0;
    return;
  }

  state.index =
    state.index > 0
      ? state.index - 1
      : state.queue.length - 1;

  loadCurrent();
}

async function fetchJSON(url) {
  const response = await fetch(url);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

async function loadHome() {
  statusEl.textContent = "Loading your music...";

  try {
    const data = await fetchJSON("/api/home");

    window.trendingTracks = Array.isArray(data.trending)
      ? data.trending
      : [];

    window.undergroundTracks = Array.isArray(data.underground)
      ? data.underground
      : [];

    renderCards($("#trending"), window.trendingTracks, "trending");
    renderCards($("#underground"), window.undergroundTracks, "underground");

    statusEl.textContent = "";
  } catch (error) {
    console.error("Home loading failed:", error);
    statusEl.textContent = error.message || "Unable to load music.";
  }
}

async function search(query) {
  query = query.trim();
  if (!query) return;

  showPage("search");
  $("#searchHeading").textContent = `Results for "${query}"`;
  statusEl.textContent = "Searching...";

  try {
    const data = await fetchJSON(
      `/api/search?q=${encodeURIComponent(query)}`
    );

    window.searchTracks = Array.isArray(data.results)
      ? data.results
      : [];

    renderRows($("#searchResults"), window.searchTracks, "search");
    statusEl.textContent = `${window.searchTracks.length} tracks found`;
  } catch (error) {
    console.error("Search failed:", error);
    statusEl.textContent = error.message || "Search failed.";
  }
}

async function loadGenre(genre) {
  showPage("search");
  $("#searchHeading").textContent = genre;
  statusEl.textContent = "Loading genre...";

  try {
    const data = await fetchJSON(
      `/api/genre/${encodeURIComponent(genre)}`
    );

    window.searchTracks = Array.isArray(data.results)
      ? data.results
      : [];

    renderRows($("#searchResults"), window.searchTracks, "search");
    statusEl.textContent = `${window.searchTracks.length} tracks found`;
  } catch (error) {
    console.error("Genre loading failed:", error);
    statusEl.textContent = error.message || "Genre unavailable.";
  }
}

function renderLiked() {
  renderRows($("#likedResults"), state.liked, "liked");
}

function showPage(page) {
  state.currentPage = page;

  $("#homePage").classList.toggle("hidden", page !== "home");
  $("#searchPage").classList.toggle("hidden", page !== "search");
  $("#likedPage").classList.toggle("hidden", page !== "liked");

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });
}

// Search form
$("#searchForm").addEventListener("submit", event => {
  event.preventDefault();
  search(searchInput.value);
});

searchInput.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    searchInput.value = "";
  }
});

// Main navigation
document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);

    if (button.dataset.page === "liked") {
      renderLiked();
    }

    // Works whether or not the sidebar has an ID.
    document.querySelector(".sidebar")?.classList.remove("open");
  });
});

// Genre buttons
document.querySelectorAll("[data-genre]").forEach(button => {
  button.addEventListener("click", () => {
    loadGenre(button.dataset.genre);
  });
});

// Hero play button
$("#heroPlay").addEventListener("click", () => {
  if (state.liked.length) {
    playQueue(state.liked, 0);
  } else {
    statusEl.textContent =
      "Your Liked Songs collection is empty. Like some songs first.";
  }
});

// Play/pause button
$("#playPause").addEventListener("click", async () => {
  if (!audio.src) {
    const track = state.queue[state.index];

    if (track) {
      await loadCurrent();
    } else if (window.trendingTracks.length) {
      playQueue(window.trendingTracks, 0);
    } else {
      statusEl.textContent = "No playable track is selected.";
    }

    return;
  }

  if (audio.paused) {
    try {
      await audio.play();
    } catch (error) {
      console.error("Playback failed:", error);
      statusEl.textContent =
        "Unable to play this track. Check whether its audio source is available.";
    }
  } else {
    audio.pause();
  }
});

// Next and previous
$("#next").addEventListener("click", nextTrack);
$("#previous").addEventListener("click", previousTrack);

// Shuffle
$("#shuffle").addEventListener("click", event => {
  state.shuffle = !state.shuffle;
  event.currentTarget.style.color = state.shuffle ? "#1db954" : "";
  statusEl.textContent = state.shuffle ? "Shuffle enabled" : "Shuffle disabled";
});

// Repeat
$("#repeat").addEventListener("click", event => {
  state.repeat = !state.repeat;
  event.currentTarget.style.color = state.repeat ? "#1db954" : "";
  statusEl.textContent = state.repeat ? "Repeat enabled" : "Repeat disabled";
});

// Like current track
likeCurrent.addEventListener("click", () => {
  const track = state.queue[state.index];
  if (track) toggleLike(track);
});

// Audio metadata and progress
audio.addEventListener("loadedmetadata", () => {
  durationEl.textContent = time(audio.duration);
});

audio.addEventListener("timeupdate", () => {
  currentTimeEl.textContent = time(audio.currentTime);

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    progress.value = (audio.currentTime / audio.duration) * 100;
  }
});

audio.addEventListener("play", () => {
  playPause.textContent = "❚❚";
});

audio.addEventListener("pause", () => {
  playPause.textContent = "▶";
});

audio.addEventListener("ended", nextTrack);

audio.addEventListener("error", () => {
  if (state.queue[state.index]) {
    statusEl.textContent =
      "The audio source could not be played. Try another track or configure a playable source.";
  }
  playPause.textContent = "▶";
});

// Seek bar
progress.addEventListener("input", () => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (Number(progress.value) / 100) * audio.duration;
  }
});

// Volume
$("#volume").addEventListener("input", event => {
  audio.volume = Number(event.target.value);
});

// Mobile sidebar
$("#mobileMenu").addEventListener("click", () => {
  document.querySelector(".sidebar")?.classList.toggle("open");
});

// Initialize app
showPage("home");
audio.volume = 0.8;
loadHome();
