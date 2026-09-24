import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (s) => document.querySelector(s);

const feed = $("#feed");
const statusBox = $("#status");
const backdrop = $("#composerBackdrop");
const mediaCode = $("#mediaCode");
const preview = $("#preview");
const message = $("#composerMessage");
const publishBtn = $("#publishBtn");
const mediaViewer = $("#mediaViewer");
const viewerTrack = $("#viewerTrack");
const closeViewerBtn = $("#closeViewer");

const config = window.MEDIA_FIREBASE_CONFIG;

if (!config?.projectId) {
  showStatus("Configuration Firebase manquante.", false);
  throw new Error("Firebase config missing");
}

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let selectedMode = "auto";
let renderedItems = [];
let viewerObserver = null;

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function showStatus(text, autoHide=true){
  statusBox.textContent = text;
  statusBox.classList.remove("hidden");
  if(autoHide){
    clearTimeout(showStatus.t);
    showStatus.t = setTimeout(()=>statusBox.classList.add("hidden"), 2400);
  }
}

function safeUrl(value){
  try{
    const u = new URL(String(value || "").trim());
    return ["http:","https:"].includes(u.protocol) ? u.href : null;
  }catch{
    return null;
  }
}

function inferType(url, hint=""){
  hint = String(hint || "").toLowerCase();
  if(hint.includes("image")) return "image/remote";
  if(hint.includes("video")) return "video/remote";
  if(hint.includes("iframe") || hint.includes("embed")) return "iframe/remote";

  let clean = String(url).toLowerCase().split("?")[0].split("#")[0];
  if(/\.(jpg|jpeg|png|gif|webp|avif)$/i.test(clean)) return "image/remote";
  if(/\.(mp4|webm|ogg|m4v|mov)$/i.test(clean)) return "video/remote";

  try{
    const u = new URL(url);
    if(u.hostname.includes("youtube.com") || u.hostname === "youtu.be" || u.hostname.includes("vimeo.com")){
      return "iframe/remote";
    }
  }catch{}

  return "iframe/remote";
}

function normalizeEmbeddable(url){
  try{
    const u = new URL(url);

    if(u.hostname.includes("youtube.com") && u.searchParams.get("v")){
      return `https://www.youtube.com/embed/${encodeURIComponent(u.searchParams.get("v"))}`;
    }
    if(u.hostname === "youtu.be"){
      const id = u.pathname.replace(/^\/+|\/+$/g,"");
      if(id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if(u.hostname.includes("vimeo.com")){
      const id = u.pathname.split("/").filter(Boolean).pop();
      if(/^\d+$/.test(id || "")) return `https://player.vimeo.com/video/${id}`;
    }
  }catch{}
  return url;
}

function parseMedia(raw){
  const src = String(raw || "").trim();
  if(!src) return {error:"Colle un lien, un iframe, un embed ou un BBCode."};

  const found = [];
  const add = (url, hint="") => {
    const safe = safeUrl(url);
    if(!safe) return;
    let type = inferType(safe, hint);
    let finalUrl = type.startsWith("iframe") ? normalizeEmbeddable(safe) : safe;
    if(!found.some(x => x.url === finalUrl)){
      found.push({url:finalUrl,type,remote:true});
    }
  };

  let m;

  // HTML / iframe / embed / img / video / source
  const patterns = [
    [/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, "iframe"],
    [/<embed\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, "iframe"],
    [/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, "image"],
    [/<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, "video"],
    [/<object\b[^>]*\bdata\s*=\s*["']([^"']+)["'][^>]*>/gi, "iframe"]
  ];
  patterns.forEach(([rx,hint]) => {
    while((m = rx.exec(src))) add(m[1],hint);
  });

  // BBCode
  const bb = /\[(img|video|iframe)(?:=[^\]]+)?\]\s*(https?:\/\/[^\[]+?)\s*\[\/\1\]/gi;
  while((m = bb.exec(src))){
    add(m[2].trim(),m[1].toLowerCase());
  }

  // URL(s) simples
  (src.match(/https?:\/\/[^\s"'<>\[\]]+/gi) || []).forEach(u => {
    add(u.replace(/[),.;]+$/,""), selectedMode === "url" ? "" : selectedMode);
  });

  if(!found.length) return {error:"Je n'ai trouvé aucun lien HTTP/HTTPS exploitable."};
  return {items:found.slice(0,12)};
}

function mediaMarkup(item){
  const url = escapeHtml(item.url);
  const type = String(item.type || "");

  if(type.startsWith("image")){
    return `<img src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  if(type.startsWith("video")){
    return `<video src="${url}" muted loop playsinline preload="metadata" controls></video>`;
  }
  return `<iframe src="${url}" loading="lazy"
    allow="autoplay; fullscreen; picture-in-picture"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function cardMarkup(item, index = 0){
  const isVideo = String(item.type || "").startsWith("video");
  const isFrame = String(item.type || "").startsWith("iframe");
  return `<article class="card" data-viewer-index="${Number(index) || 0}">
    ${mediaMarkup(item)}
    ${(isVideo || isFrame) ? `<span class="playBadge">▶</span>` : ""}
    <button class="openCard" type="button" aria-label="Ouvrir en plein écran"></button>
  </article>`;
}

function viewerSlideMarkup(item, index){
  const url = escapeHtml(item.url);
  const type = String(item.type || "");
  let media = "";

  if(type.startsWith("image")){
    media = `<img src="${url}" alt="" draggable="false">`;
  }else if(type.startsWith("video")){
    media = `<video src="${url}" muted loop playsinline preload="metadata" controls></video>`;
  }else{
    media = `<iframe src="${url}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  return `<section class="viewerSlide" data-slide-index="${index}">
    <div class="viewerMedia">${media}</div>
  </section>`;
}

function setupViewerAutoplay(){
  if(viewerObserver) viewerObserver.disconnect();

  viewerObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if(!entry.isIntersecting || entry.intersectionRatio < .7) return;

      viewerTrack.querySelectorAll("video").forEach((video) => {
        if(entry.target.contains(video)){
          video.play().catch(()=>{});
        }else{
          video.pause();
        }
      });
    });
  }, {root:viewerTrack, threshold:[.7]});

  viewerTrack.querySelectorAll(".viewerSlide").forEach(slide => viewerObserver.observe(slide));
}

function openViewer(index){
  if(!renderedItems.length) return;
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, renderedItems.length - 1));

  viewerTrack.innerHTML = renderedItems.map((item, i) => viewerSlideMarkup(item, i)).join("");
  mediaViewer.classList.remove("hidden");
  mediaViewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("viewerOpen");
  setupViewerAutoplay();

  requestAnimationFrame(() => {
    const target = viewerTrack.querySelector(`.viewerSlide[data-slide-index="${safeIndex}"]`);
    if(target) viewerTrack.scrollTop = target.offsetTop;
  });
}

function closeViewer(){
  if(mediaViewer.classList.contains("hidden")) return;
  viewerTrack.querySelectorAll("video").forEach(video => video.pause());
  if(viewerObserver){
    viewerObserver.disconnect();
    viewerObserver = null;
  }
  mediaViewer.classList.add("hidden");
  mediaViewer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("viewerOpen");
  viewerTrack.innerHTML = "";
}

function readMediaItems(data){
  if(Array.isArray(data.mediaItems) && data.mediaItems.length){
    return data.mediaItems
      .map(item => ({
        url: safeUrl(item?.url),
        type: item?.type || inferType(item?.url || "")
      }))
      .filter(x => x.url);
  }

  // Compatibilité avec cette page si un document plus simple existe.
  if(data.src){
    const url = safeUrl(data.src);
    if(url) return [{url,type:data.type || inferType(url)}];
  }
  if(data.url){
    const url = safeUrl(data.url);
    if(url) return [{url,type:data.type || inferType(url)}];
  }
  return [];
}

function renderDocuments(docs){
  const posts = docs
    .map(docSnap => ({id:docSnap.id,...docSnap.data()}))
    .sort((a,b)=>(Number(b.createdAtMs)||0)-(Number(a.createdAtMs)||0));

  const items = posts.flatMap(post => readMediaItems(post).slice(0,1));
  renderedItems = items;
  feed.innerHTML = items.map((item, index) => cardMarkup(item, index)).join("");

  feed.querySelectorAll("video").forEach(video => {
    const play = () => video.play().catch(()=>{});
    const pause = () => video.pause();
    video.addEventListener("mouseenter",play);
    video.addEventListener("mouseleave",pause);
  });

  if(!items.length){
    showStatus("Aucune publication pour le moment.", false);
  }else{
    statusBox.classList.add("hidden");
  }
}

async function ensureAnonymousAuth(){
  if(auth.currentUser) return auth.currentUser;
  const result = await signInAnonymously(auth);
  return result.user;
}

async function publish(){
  message.textContent = "";
  const parsed = parseMedia(mediaCode.value);
  if(parsed.error){
    message.textContent = parsed.error;
    return;
  }

  publishBtn.disabled = true;
  publishBtn.textContent = "Publication…";

  try{
    const user = await ensureAnonymousAuth();

    await addDoc(collection(db,"guest_posts"),{
      author:"Visiteur",
      handle:"@visiteur",
      caption:"",
      tags:"",
      mediaItems:parsed.items,
      postType:"Publication",
      layout:parsed.items.length > 1 ? "carousel" : "carousel",
      likes:0,
      comments:0,
      shares:0,
      saves:0,
      createdAtMs:Date.now(),
      guestUid:user.uid
    });

    closeComposer();
    showStatus("Publication ajoutée.");
  }catch(err){
    console.error(err);
    message.textContent = "Publication impossible. Vérifie Firebase Auth et les règles Firestore.";
  }finally{
    publishBtn.disabled = false;
    publishBtn.textContent = "Publier";
  }
}

function buildPreview(){
  message.textContent = "";
  const parsed = parseMedia(mediaCode.value);
  preview.innerHTML = "";
  if(parsed.error){
    message.textContent = parsed.error;
    return;
  }
  preview.innerHTML = cardMarkup(parsed.items[0], 0);
}

function openComposer(){
  mediaCode.value = "";
  preview.innerHTML = "";
  message.textContent = "";
  backdrop.classList.remove("hidden");
  setTimeout(()=>mediaCode.focus(),50);
}

function closeComposer(){
  backdrop.classList.add("hidden");
}

feed.addEventListener("click", (event) => {
  const opener = event.target.closest(".openCard");
  if(!opener) return;
  const card = opener.closest(".card");
  if(!card) return;
  openViewer(Number(card.dataset.viewerIndex || 0));
});

closeViewerBtn.addEventListener("click", closeViewer);

$("#openComposer").addEventListener("click",openComposer);
$("#closeComposer").addEventListener("click",closeComposer);
$("#previewBtn").addEventListener("click",buildPreview);
$("#publishBtn").addEventListener("click",publish);

backdrop.addEventListener("click",e=>{
  if(e.target === backdrop) closeComposer();
});
document.addEventListener("keydown",e=>{
  if(e.key === "Escape"){
    closeViewer();
    closeComposer();
  }
});

document.querySelectorAll(".formatTab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    selectedMode = btn.dataset.mode || "auto";
    document.querySelectorAll(".formatTab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
  });
});

onAuthStateChanged(auth,user=>{
  currentUser = user || null;
});

try{
  await ensureAnonymousAuth();

  onSnapshot(
    collection(db,"guest_posts"),
    snap => renderDocuments(snap.docs),
    err => {
      console.error(err);
      showStatus("Impossible de lire Firestore.", false);
    }
  );
}catch(err){
  console.error(err);
  showStatus("Connexion Firebase impossible.", false);
}
