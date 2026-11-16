// アルバム確認(スマホ用の閲覧ページ): パソコンのアプリ「確認用URLに公開」で送られた
// アルバムの、ページ構成と写真一覧(配置済み/未使用)を見る。見るだけで、編集はしない。
// 「確認済みにする」は、この端末の中で一覧から隠すだけ(公開データは消えない)。
(function () {
  const PAGE_HEIGHT_PT = (21 / 2.54) * 72;
  const CONF_KEY = "albumReviewConfirmed";
  const $ = (id) => document.getElementById(id);

  let index = null;
  let curId = null;
  let cur = null;
  let libByName = new Map();
  let tab = "pages";
  let filter = "all";
  let showConfirmed = false;
  // 写真は、16枚ずつのファイル(チャンク)に入っている。使うときに読み込んで、使い回す。
  let chunkCache = new Map(); // チャンク名 → { state, images, waiters }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  // 確認済み(この端末の中だけ): { albumId: 確認したときの更新日時 }
  function getConfirmed() {
    try {
      return JSON.parse(localStorage.getItem(CONF_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function setConfirmed(obj) {
    try {
      localStorage.setItem(CONF_KEY, JSON.stringify(obj));
    } catch (e) {
      /* 保存できなくても見られる */
    }
  }
  // 確認済みで、その後に更新されていない
  function isHidden(a) {
    const c = getConfirmed()[a.id];
    return c !== undefined && c === a.updatedAt;
  }
  function isUpdatedAfterConfirm(a) {
    const c = getConfirmed()[a.id];
    return c !== undefined && c !== a.updatedAt;
  }

  async function getJson(path, bust) {
    const r = await fetch(path + (bust ? "?t=" + bust : "?t=" + Date.now()), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }

  // ---------- ページの種類 ----------
  function layoutOf(page) {
    return window.AlbumLayouts.getLayout(page.count, page.variant || 0, !!page.spread);
  }
  function isCoverPage(page) {
    if (page.blank || page.backCover || page.spread) return false;
    const l = layoutOf(page);
    return !!(l.label && l.label.indexOf("表紙") === 0);
  }
  function pageName(pages, i) {
    const p = pages[i];
    if (p.backCover) return `ページ${i + 1} 裏表紙`;
    if (isCoverPage(p)) return `ページ${i + 1} 表紙`;
    return `ページ${i + 1}` + (p.spread ? "(見開き)" : "");
  }

  // ---------- 描画(スマホ編集版と同じ) ----------
  function computeCoverBox(frameAspect, imgAspect, scale, tx, ty) {
    scale = Math.max(1, scale || 1);
    let baseW, baseH;
    if (imgAspect > frameAspect) {
      baseH = 100;
      baseW = 100 * (imgAspect / frameAspect);
    } else {
      baseW = 100;
      baseH = 100 * (frameAspect / imgAspect);
    }
    const wPct = baseW * scale;
    const hPct = baseH * scale;
    const posX = 50 + (tx || 0) * 50;
    const posY = 50 + (ty || 0) * 50;
    return { left: (100 - wPct) * (posX / 100), top: (100 - hPct) * (posY / 100), w: wPct, h: hPct };
  }
  function coverText(t) {
    const c = (cur && cur.cover) || {};
    if (t === "title" || t === "name") return c.title || t;
    if (t === "event") return c.event || t;
    if (t === "DDth Mon. YYYY") return c.date || t;
    return t;
  }
  // 写真の画像を、<img> に入れる。まだ読み込んでいないチャンクなら、読み込んだあとに入れる。
  function loadChunk(name) {
    let c = chunkCache.get(name);
    if (c) return c.promise;
    c = { images: null, promise: null };
    c.promise = getJson(`data/chunks/${name}`, name).then((j) => {
      c.images = j;
      return j;
    });
    chunkCache.set(name, c);
    return c.promise;
  }
  function setImageSrc(img, photo) {
    if (photo.thumb) {
      img.src = photo.thumb; // 前の形式(写真を構成の中に直接入れていた版)
      return;
    }
    const c = photo.chunk ? chunkCache.get(photo.chunk) : null;
    if (c && c.images) {
      img.src = c.images[photo.name] || "";
      return;
    }
    img.classList.add("loading");
    loadChunk(photo.chunk).then((images) => {
      img.src = images[photo.name] || "";
      img.classList.remove("loading");
    }).catch(() => {});
  }

  function renderPage(page) {
    const el = document.createElement("div");
    el.className = "page " + (page.spread ? "sp" : "sq");
    const bg = cur && cur.cover && cur.cover.bgColor ? "#" + cur.cover.bgColor : "#fff";
    if (page.backCover) {
      el.classList.add("fixed-note");
      el.style.background = bg;
      el.textContent = "裏表紙";
      return el;
    }
    if (page.blank) return el;
    const layout = layoutOf(page);
    const isCover = !page.spread && layout.label && layout.label.indexOf("表紙") === 0;
    if (isCover) el.style.background = bg;
    const pageAspect = page.spread ? 2 : 1;
    layout.frames.forEach((rect, i) => {
      const f = page.frames[i] || { photo: null };
      const fe = document.createElement("div");
      fe.className = "frame";
      fe.style.left = rect.x * 100 + "%";
      fe.style.top = rect.y * 100 + "%";
      fe.style.width = rect.w * 100 + "%";
      fe.style.height = rect.h * 100 + "%";
      const photo = f.photo ? libByName.get(f.photo) : null;
      if (photo && (photo.chunk || photo.thumb)) {
        const img = document.createElement("img");
        setImageSrc(img, photo);
        const fa = (rect.w * pageAspect) / rect.h;
        const ia = (photo.width || 3) / (photo.height || 2);
        const b = computeCoverBox(fa, ia, f.scale, f.tx, f.ty);
        img.style.left = b.left + "%";
        img.style.top = b.top + "%";
        img.style.width = b.w + "%";
        img.style.height = b.h + "%";
        const wrap = document.createElement("div");
        wrap.className = "photo-wrap";
        if (f.flipX) wrap.style.transform = "scaleX(-1)";
        wrap.appendChild(img);
        fe.appendChild(wrap);
      }
      el.appendChild(fe);
    });
    if (isCover) {
      (layout.texts || []).forEach((t) => {
        const te = document.createElement("div");
        te.className = "txt";
        te.style.left = t.x * 100 + "%";
        te.style.top = t.y * 100 + "%";
        te.style.width = t.w * 100 + "%";
        te.style.height = t.h * 100 + "%";
        te.style.color = "#" + t.color;
        te.style.fontWeight = t.bold ? "700" : "400";
        te.style.fontSize = ((t.fontPt / PAGE_HEIGHT_PT) * 100).toFixed(2) + "cqh";
        te.style.fontFamily = t.fontFamily === "Amalfi Coast" ? "'Snell Roundhand','Zapfino',cursive" : "-apple-system,sans-serif";
        te.textContent = coverText(t.text);
        el.appendChild(te);
      });
    }
    return el;
  }

  // ---------- アルバム一覧(上のチップ) ----------
  function visibleAlbums() {
    return index.albums.filter((a) => showConfirmed || !isHidden(a));
  }
  function renderChips() {
    const box = $("album-chips");
    box.innerHTML = "";
    visibleAlbums().forEach((a) => {
      const b = document.createElement("button");
      b.className = "chip" + (a.id === curId ? " on" : "");
      b.textContent = a.name + (isHidden(a) ? "(確認済み)" : "");
      if (isUpdatedAfterConfirm(a)) {
        const u = document.createElement("span");
        u.className = "upd";
        u.textContent = "更新";
        b.appendChild(u);
      }
      b.onclick = () => openAlbum(a.id);
      box.appendChild(b);
    });
    const hiddenCount = index.albums.filter(isHidden).length;
    $("confirmed-bar").hidden = hiddenCount === 0;
    $("btn-toggle-confirmed").textContent = showConfirmed ? "確認済みを隠す" : `確認済み ${hiddenCount}件を表示する`;
  }

  async function openAlbum(id) {
    curId = id;
    const meta = index.albums.find((a) => a.id === id);
    renderChips();
    $("album").hidden = true;
    $("empty").hidden = true;
    try {
      cur = await getJson(`data/${id}.json`, meta ? meta.updatedAt : Date.now());
    } catch (e) {
      $("empty").hidden = false;
      $("empty").textContent = "アルバムを読み込めませんでした。しばらくして、もう一度開いてください。";
      return;
    }
    libByName = new Map(cur.library.map((p) => [p.name, p]));
    chunkCache = new Map();
    $("album").hidden = false;
    $("btn-confirm").hidden = isHidden(meta || {});
    renderSummary();
    renderPages();
    renderPhotos();
    window.scrollTo(0, 0);
    preloadChunks();
  }

  // 使っている写真を含むファイルから先に、順に読み込む(同時に3つまで)
  function preloadChunks() {
    const u = usageMap();
    const order = [];
    const seen = new Set();
    const add = (p) => {
      if (p.chunk && !seen.has(p.chunk)) {
        seen.add(p.chunk);
        order.push(p.chunk);
      }
    };
    cur.library.filter((p) => u.has(p.name)).forEach(add);
    cur.library.forEach(add);
    const total = order.length;
    let done = 0;
    let next = 0;
    const setStatus = () => {
      const el = $("loading");
      el.hidden = done >= total;
      el.textContent = `写真を読み込み中 ${done}/${total}`;
    };
    setStatus();
    const myId = curId;
    async function worker() {
      while (next < order.length && curId === myId) {
        const name = order[next++];
        try {
          await loadChunk(name);
        } catch (e) {
          /* 読めなくても、続ける */
        }
        done += 1;
        setStatus();
      }
    }
    worker();
    worker();
    worker();
  }

  function usageMap() {
    const map = new Map();
    cur.pages.forEach((p, i) => {
      if (p.blank || p.backCover) return;
      p.frames.forEach((f) => {
        if (!f.photo) return;
        if (!map.has(f.photo)) map.set(f.photo, []);
        if (map.get(f.photo).indexOf(i) === -1) map.get(f.photo).push(i);
      });
    });
    return map;
  }

  function renderSummary() {
    const u = usageMap();
    const total = cur.library.length;
    const used = cur.library.filter((p) => u.has(p.name)).length;
    const fav = cur.library.filter((p) => p.mark === "fav").length;
    const d = new Date(cur.updatedAt);
    const body = cur.pages.reduce((n, p) => (p.backCover || p.blank || isCoverPage(p) ? n : n + (p.spread ? 2 : 1)), 0);
    $("summary").innerHTML =
      `<b>${esc(cur.name)}</b><br>` +
      `本文 ${body}ページ ／ 写真 ${total}枚(使用 ${used}枚・未使用 ${total - used}枚・お気に入り ${fav}枚)<br>` +
      `<span class="sub">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} に更新</span>`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---------- ページ構成 ----------
  function groups(pages) {
    const out = [];
    let i = 0;
    while (i < pages.length) {
      const p = pages[i];
      if (p.spread) {
        out.push([i]);
        i += 1;
        continue;
      }
      const n = pages[i + 1];
      if (n && !n.spread) {
        out.push([i, i + 1]);
        i += 2;
      } else {
        out.push([i]);
        i += 1;
      }
    }
    return out;
  }
  function pageCell(i) {
    const p = cur.pages[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.id = "pg" + i;
    const pe = renderPage(p);
    pe.addEventListener("click", () => openPageOverlay(i));
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = pageName(cur.pages, i);
    cell.append(pe, cap);
    return cell;
  }
  function renderPages() {
    const box = $("tab-pages");
    box.innerHTML = "";
    groups(cur.pages).forEach((g) => {
      const wrap = document.createElement("div");
      wrap.className = "group";
      if (g.length === 1 && cur.pages[g[0]].spread) {
        const sp = document.createElement("div");
        sp.className = "group-spread";
        sp.appendChild(pageCell(g[0]));
        wrap.appendChild(sp);
      } else {
        const pair = document.createElement("div");
        pair.className = "pair";
        g.forEach((i) => pair.appendChild(pageCell(i)));
        wrap.appendChild(pair);
      }
      box.appendChild(wrap);
    });
  }
  function openPageOverlay(i) {
    const body = $("overlay-body");
    body.innerHTML = "";
    body.appendChild(renderPage(cur.pages[i]));
    const info = document.createElement("div");
    info.className = "info";
    info.textContent = pageName(cur.pages, i);
    body.appendChild(info);
    $("overlay").hidden = false;
  }

  // ---------- 写真一覧 ----------
  function renderFilters() {
    const defs = [["all", "すべて"], ["used", "配置済み"], ["unused", "未使用"], ["fav", "お気に入り"]];
    const box = $("filters");
    box.innerHTML = "";
    defs.forEach(([k, label]) => {
      const b = document.createElement("button");
      b.className = "pill" + (filter === k ? " on" : "");
      b.textContent = label;
      b.onclick = () => {
        filter = k;
        renderFilters();
        renderPhotos();
      };
      box.appendChild(b);
    });
  }
  function renderPhotos() {
    const u = usageMap();
    const grid = $("photo-grid");
    grid.innerHTML = "";
    const list = cur.library.filter((p) => {
      const used = u.has(p.name);
      if (filter === "used") return used;
      if (filter === "unused") return !used;
      if (filter === "fav") return p.mark === "fav";
      return true;
    });
    list.forEach((p) => {
      const cell = document.createElement("div");
      cell.className = "pcell";
      const used = u.get(p.name);
      const th = document.createElement("button");
      th.className = "pthumb" + (used ? " used" : "");
      th.innerHTML = `<span class="badge no">#${p.no}</span>` +
        (p.mark ? `<span class="badge mark ${p.mark}">${p.mark === "fav" ? "お気に入り" : p.mark === "maybe" ? "迷い" : "NG"}</span>` : "");
      if (p.chunk || p.thumb) {
        const im = document.createElement("img");
        im.alt = "";
        im.decoding = "async";
        setImageSrc(im, p);
        th.insertBefore(im, th.firstChild);
      }
      th.onclick = () => openPhotoOverlay(p, used);
      const cap = document.createElement("div");
      cap.className = "pcap";
      const nm = String(p.name).replace(/\.[^.]+$/, "");
      cap.innerHTML = `<span class="nm">${esc(nm)}</span><br>` +
        (used ? `<span class="st">配置済み ${used.map((i) => "p" + (i + 1)).join(",")}</span>` : `<span class="st un">未使用</span>`);
      cell.append(th, cap);
      grid.appendChild(cell);
    });
    if (list.length === 0) grid.innerHTML = '<p class="empty" style="grid-column:1/-1">該当する写真はありません</p>';
  }
  function openPhotoOverlay(p, used) {
    const body = $("overlay-body");
    body.innerHTML = "";
    if (p.chunk || p.thumb) {
      const img = document.createElement("img");
      img.className = "big-photo";
      setImageSrc(img, p);
      body.appendChild(img);
    }
    const info = document.createElement("div");
    info.className = "info";
    info.innerHTML = `#${p.no}　${esc(p.name)}<br>` + (used ? `配置済み: ` : "未使用");
    if (used) {
      used.forEach((i) => {
        const b = document.createElement("button");
        b.textContent = "p" + (i + 1);
        b.onclick = () => {
          $("overlay").hidden = true;
          setTab("pages");
          const el = $("pg" + i);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        };
        info.appendChild(b);
      });
    }
    body.appendChild(info);
    $("overlay").hidden = false;
  }

  function setTab(name) {
    tab = name;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $("tab-pages").hidden = name !== "pages";
    $("tab-photos").hidden = name !== "photos";
    window.scrollTo(0, 0);
  }

  async function init() {
    document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
    $("overlay-close").onclick = () => ($("overlay").hidden = true);
    $("overlay").addEventListener("click", (e) => {
      if (e.target === $("overlay")) $("overlay").hidden = true;
    });
    $("btn-toggle-confirmed").onclick = () => {
      showConfirmed = !showConfirmed;
      renderChips();
    };
    $("btn-confirm").onclick = () => {
      if (!cur) return;
      const meta = index.albums.find((a) => a.id === curId);
      if (!meta) return;
      if (!confirm(`「${meta.name}」を確認済みにして、この端末の一覧から消しますか?\n(あとで「確認済みを表示する」から戻せます)`)) return;
      const c = getConfirmed();
      c[meta.id] = meta.updatedAt;
      setConfirmed(c);
      toast("確認済みにしました");
      cur = null;
      curId = null;
      showHomeOrFirst();
    };
    renderFilters();
    try {
      index = await getJson("data/index.json");
    } catch (e) {
      $("empty").hidden = false;
      $("empty").textContent = "読み込めませんでした。通信の状態を確認して、開き直してください。";
      return;
    }
    showHomeOrFirst();
  }

  function showHomeOrFirst() {
    $("album").hidden = true;
    renderChips();
    const list = visibleAlbums();
    if (list.length === 0) {
      $("empty").hidden = false;
      $("empty").innerHTML = index.albums.length === 0 ? "まだ公開されているアルバムはありません。" : "すべて確認済みです。<br>新しく公開されると、ここに出ます。";
      return;
    }
    $("empty").hidden = true;
    openAlbum(list[0].id);
  }

  init();
})();
