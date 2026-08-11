// ==UserScript==
// @name         Skribbl Assistant FR
// @namespace    http://tampermonkey.net/
// @supportURL   https://github.com/Sakqu/Skribbl-Assistant-FR
// @version      1.14
// @description  Assistant de mots pour Skribbl.io en français : suggestions filtrées par les indices, complétion au clavier et réponse automatique 100% optionnelle.
// @author       Sakqu
// @match        http*://skribbl.io/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=skribbl.io
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// @compatible   chrome
// @compatible   firefox
// @compatible   opera
// @compatible   safari
// @compatible   edge
// ==/UserScript==

(function () {
'use strict';

/* ════════════════════════════ Réglages ════════════════════════════ */

const DEFAULTS = {
    autoGuess: false,     // envoyer les mots automatiquement dans le chat
    enterFill: false,     // Entrée = envoyer la 1re suggestion au lieu de ce qui est tapé
    autoRange: '4-8',     // plage de délai entre deux envois automatiques (secondes)
    expanded: false,      // panneau agrandi (sinon une seule ligne de suggestions)
    fuzzy: false,         // tolérer une faute de frappe dans la recherche
    autoCollapse: true,   // revenir à une ligne pendant votre tour de dessin
};

// Plages proposées, en secondes. Chaque envoi tire un délai au hasard dans la
// plage : un rythme parfaitement régulier est ce qui trahit le plus un script.
const RANGES = {
    '2-4':  [2000, 4000],
    '4-8':  [4000, 8000],
    '6-12': [6000, 12000],
    '10-20': [10000, 20000],
};

const settings = {};
for (const [key, value] of Object.entries(DEFAULTS)) {
    settings[key] = GM_getValue(`sa_${key}`, value);
}

// Les versions ≤ 1.13 stockaient un délai fixe (sa_autoDelay, en ms). On le
// convertit une fois vers la plage la plus proche pour ne pas perdre le réglage.
if (!RANGES[settings.autoRange]) {
    const legacy = Number(GM_getValue('sa_autoDelay', 0));
    const fallback = legacy >= 10000 ? '10-20'
        : legacy >= 7000 ? '6-12'
        : legacy > 0 && legacy < 4000 ? '2-4'
        : DEFAULTS.autoRange;
    settings.autoRange = fallback;
    GM_setValue('sa_autoRange', fallback);
}

function setSetting(key, value) {
    settings[key] = value;
    GM_setValue(`sa_${key}`, value);
}

const MAX_CHIPS = 200;          // nombre max de pastilles affichées (perf)
const COMPACT_CHIPS = 40;       // en mode une ligne : au-delà, défiler devient pénible
const WORDLIST_URL = 'https://raw.githubusercontent.com/Sakqu/Skribbl-Assistant-FR/main/listedemot.txt';


/* ════════════════════════════ Utilitaires ════════════════════════════ */

const chatInput = () => document.querySelector('#game-chat input[data-translate="placeholder"]');
const chatForm = () => document.querySelector('#game-chat form');

// Retire les accents : permet de taper "elephant" pour trouver "éléphant".
const strip = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Une case masquée d'un indice = n'importe quelle lettre, accents compris.
const LETTER = '\\p{L}';

function waitFor(selector, timeout = 60000) {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) return resolve(existing);

        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                observer.disconnect();
                resolve(found);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
}

// Est-ce que c'est à moi de dessiner ? (on ne devine pas pendant son propre tour)
// On se fie au chat, qui annonce le dessinateur : la barre d'outils #game-toolbar
// reste présente dans la page entre les tours, donc sa visibilité ne dit rien.
let currentDrawer = '';

const sameName = (a, b) => !!a && !!b && strip(a.toLowerCase()) === strip(b.toLowerCase());

function isDrawing() {
    return sameName(currentDrawer, myUsername);
}


/* ════════════════════════════ Interface ════════════════════════════ */

// Le panneau emprunte les variables de thème de skribbl (définies sur :root dans
// son style.css) : il suit donc automatiquement le thème choisi par le joueur,
// y compris les thèmes sombre et événementiels. Les valeurs après la virgule
// servent de repli si skribbl change ses noms de variables.
const CSS = `
.sa-panel {
    --sa-bg: var(--COLOR_PANEL_BG, rgba(12, 44, 150, .75));
    --sa-lo: var(--COLOR_PANEL_LO, rgba(7, 36, 131, .75));
    --sa-hi: var(--COLOR_PANEL_HI, #1640c9);
    --sa-text: var(--COLOR_PANEL_TEXT, #f0f0f0);
    --sa-border: var(--COLOR_PANEL_BORDER, #040a33);
    --sa-btn: var(--COLOR_PANEL_BUTTON, #2a51d1);
    --sa-btn-hover: var(--COLOR_PANEL_BUTTON_HOVER, #1e44be);
    --sa-btn-active: var(--COLOR_PANEL_BUTTON_ACTIVE, #1d40b4);
    --sa-focus: var(--COLOR_PANEL_BORDER_FOCUS, #56b2fd);
    --sa-accent: var(--COLOR_PANEL_FOCUS, #ee9631);
    --sa-radius: var(--BORDER_RADIUS, 3px);
    --sa-gap: var(--BORDER_GAP, 6px);

    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 2147483000;
    font-family: Nunito, sans-serif;
    font-size: var(--FONT_SIZE, 14px);
    color: var(--sa-text);
    background-color: var(--sa-bg);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border-top: 2px solid var(--sa-border);
}
.sa-panel * { box-sizing: border-box; }

.sa-head {
    display: flex; align-items: center; flex-wrap: wrap;
    gap: var(--sa-gap); row-gap: 4px;
    padding: 5px var(--sa-gap);
}
/* Bloc d'identité : titre sur une ligne, signature en dessous.
   L'ombre portée dure est la signature visuelle de skribbl (cf. --DROPSHADOW). */
.sa-brand {
    display: flex; flex-direction: column;
    line-height: 1.08;
    white-space: nowrap;
    margin-right: 2px;
}
.sa-title {
    font-size: .95em; font-weight: 800; letter-spacing: .01em;
    text-shadow: 2px 2px 0 rgba(0, 0, 0, .25);
}
.sa-title-hi {
    margin-left: .3em;
    color: var(--sa-accent);
}
.sa-by {
    width: fit-content;
    font-size: .62em; font-weight: 700; font-style: italic;
    color: inherit; opacity: .5;
    text-decoration: none;
    transition: opacity .1s;
}
.sa-by:hover { opacity: 1; text-decoration: underline; }
.sa-count {
    font-family: Inconsolata, monospace;
    font-size: .92em; font-weight: bolder;
    white-space: nowrap;
}
.sa-count[data-paused="true"] { color: var(--sa-accent); }
.sa-hint {
    font-size: .76em; font-weight: 700; opacity: .55;
    white-space: nowrap;
}
.sa-hint kbd { font-family: inherit; font-weight: 800; }
.sa-spacer { margin-left: auto; }

.sa-btn {
    display: inline-flex; align-items: center; gap: 5px;
    height: 22px; padding: 0 8px;
    font: inherit; font-size: .76em; font-weight: 800;
    color: var(--sa-text); cursor: pointer;
    background-color: var(--sa-lo);
    border: 0;
    border-radius: var(--sa-radius);
    transition: background-color .1s;
}
.sa-btn:hover { background-color: var(--sa-btn-hover); }
.sa-btn:active { background-color: var(--sa-btn-active); }
.sa-btn[data-on="true"] { background-color: var(--sa-btn); }
.sa-led {
    width: 5px; height: 5px; border-radius: 50%;
    background-color: currentColor; opacity: .3;
}
.sa-btn[data-on="true"] .sa-led { opacity: 1; }
.sa-select {
    height: 22px; padding: 0 3px;
    font: inherit; font-size: .76em; font-weight: 800;
    color: var(--sa-text); cursor: pointer;
    background-color: var(--sa-lo);
    border: 0;
    border-radius: var(--sa-radius);
}
.sa-select option { background-color: var(--sa-hi); color: var(--sa-text); }
.sa-icon { width: 22px; padding: 0; justify-content: center; }

/* Par défaut : une seule ligne, on fait défiler sur le côté.
   Le panneau ne mange ainsi qu'une bande fine en bas de l'écran. */
.sa-body {
    display: flex; align-items: center;
    flex-wrap: nowrap; gap: 4px;
    padding: 0 var(--sa-gap) 6px;
    overflow-x: auto; overflow-y: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--sa-hi) transparent;
    overscroll-behavior-x: contain;
}
/* Agrandi par la flèche : plusieurs lignes, défilement vertical. */
.sa-panel[data-expanded="true"] .sa-body {
    align-items: flex-start;
    flex-wrap: wrap;
    max-height: 30vh;
    overflow-x: hidden; overflow-y: auto;
}
.sa-panel[data-paused="true"] .sa-body { opacity: .5; }

.sa-body::-webkit-scrollbar { width: 8px; height: 8px; }
.sa-body::-webkit-scrollbar-track { background: transparent; }
.sa-body::-webkit-scrollbar-thumb {
    background-color: var(--sa-hi);
    border-radius: var(--sa-radius);
}

.sa-chip {
    flex: 0 0 auto;
    padding: 3px 8px;
    font-size: .82em; font-weight: 700; line-height: 1.3;
    white-space: nowrap;
    color: var(--sa-text); cursor: pointer; user-select: none;
    background-color: var(--sa-lo);
    border-radius: var(--sa-radius);
    transition: background-color .1s;
}
.sa-chip:hover { background-color: var(--sa-btn-hover); }
/* La meilleure suggestion : celle que Tab complète. */
.sa-chip--top { background-color: var(--sa-btn); }
.sa-chip--top:hover { background-color: var(--sa-btn-hover); }
.sa-chip-typed { opacity: .45; }
.sa-more {
    flex: 0 0 auto; align-self: center;
    padding: 3px 4px; font-size: .76em; font-weight: 700; opacity: .5;
}
.sa-empty {
    font-size: .78em; font-weight: 700; opacity: .5;
    white-space: nowrap;
}

.sa-ghost {
    position: absolute;
    pointer-events: none;
    /* Se superpose au champ de chat : on suit sa couleur de texte, sinon
       l'aperçu devient invisible sur le thème sombre. */
    color: var(--COLOR_INPUT_TEXT, #2c2c2c);
    opacity: .4;
    white-space: pre;
    z-index: 5;
}

.sa-btn:focus-visible, .sa-select:focus-visible, .sa-chip:focus-visible {
    outline: 2px solid var(--sa-focus);
    outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
    .sa-btn, .sa-chip { transition: none; }
}

/* Écrans étroits : l'aide clavier saute en premier, puis la signature.
   L'en-tête doit tenir sur une ligne, sinon le panneau ronge l'écran.
   Le compteur de lettres, lui, reste toujours visible. */
@media (max-width: 1100px) {
    .sa-keys { display: none; }
}
@media (max-width: 900px) {
    .sa-by { display: none; }
}
`;

const styleElem = document.createElement('style');
styleElem.textContent = CSS;
(document.head || document.documentElement).appendChild(styleElem);

const panel = document.createElement('div');
panel.className = 'sa-panel';
panel.dataset.expanded = String(settings.expanded);
panel.dataset.paused = 'false';
panel.innerHTML = `
    <div class="sa-head">
        <span class="sa-brand">
            <span class="sa-title">Skribbl<span class="sa-title-hi">Assistant</span></span>
            <a class="sa-by" href="https://github.com/Sakqu/Skribbl-Assistant-FR"
               target="_blank" rel="noopener noreferrer">Made By Sakqu</a>
        </span>
        <span class="sa-count" id="sa-count">0 mot</span>
        <span class="sa-hint" id="sa-letters"></span>
        <span class="sa-hint sa-keys"><kbd>Tab</kbd> compléter · clic pour envoyer</span>
        <span class="sa-spacer"></span>
        <button class="sa-btn" id="sa-auto" type="button" title="Envoie les mots tout seul dans le chat, sans intervention de votre part">
            <span class="sa-led"></span>Envoi auto
        </button>
        <select class="sa-select" id="sa-delay" title="Chaque envoi attend une durée tirée au hasard dans cette plage">
            <option value="2-4">2-4 s</option>
            <option value="4-8">4-8 s</option>
            <option value="6-12">6-12 s</option>
            <option value="10-20">10-20 s</option>
        </select>
        <button class="sa-btn" id="sa-enter" type="button" title="La touche Entrée envoie la meilleure suggestion au lieu de ce que vous avez tapé">
            <span class="sa-led"></span>Entrée = suggestion
        </button>
        <button class="sa-btn" id="sa-fuzzy" type="button" title="Retrouve un mot même avec une faute de frappe, et cherche aussi au milieu des mots">
            <span class="sa-led"></span>Fautes tolérées
        </button>
        <button class="sa-btn" id="sa-fold" type="button" title="Revient automatiquement à une ligne pendant votre tour de dessin">
            <span class="sa-led"></span>Réduire en dessinant
        </button>
        <button class="sa-btn" id="sa-export" type="button" title="Télécharger les mots découverts">Exporter</button>
        <button class="sa-btn sa-icon" id="sa-toggle" type="button" title="Réduire / agrandir">▾</button>
    </div>
    <div class="sa-body" id="sa-body"></div>
`;
document.body.appendChild(panel);

const countElem = panel.querySelector('#sa-count');
const lettersElem = panel.querySelector('#sa-letters');
const bodyElem = panel.querySelector('#sa-body');
const autoBtn = panel.querySelector('#sa-auto');
const enterBtn = panel.querySelector('#sa-enter');
const fuzzyBtn = panel.querySelector('#sa-fuzzy');
const foldBtn = panel.querySelector('#sa-fold');
const delaySel = panel.querySelector('#sa-delay');
const exportBtn = panel.querySelector('#sa-export');
const toggleBtn = panel.querySelector('#sa-toggle');

// Mis à vrai quand vous rouvrez le panneau alors que le repli automatique
// l'avait fermé ; remis à faux à la fin de votre tour.
let pauseFoldOverride = false;

// Pendant votre tour de dessin, on force le retour à une ligne — sauf si vous
// avez explicitement rouvert le panneau (pauseFoldOverride).
function isExpanded() {
    if (isPaused && settings.autoCollapse && !pauseFoldOverride) return false;
    return settings.expanded;
}

function syncControls() {
    autoBtn.dataset.on = String(settings.autoGuess);
    enterBtn.dataset.on = String(settings.enterFill);
    fuzzyBtn.dataset.on = String(settings.fuzzy);
    foldBtn.dataset.on = String(settings.autoCollapse);
    delaySel.value = settings.autoRange;
    delaySel.style.display = settings.autoGuess ? '' : 'none';

    const expanded = isExpanded();
    toggleBtn.textContent = expanded ? '▾' : '▴';
    toggleBtn.title = expanded ? 'Revenir à une ligne' : 'Agrandir pour voir tous les mots';
    panel.dataset.expanded = String(expanded);
}


/* ════════════════════════════ Base de mots ════════════════════════════ */

const correctAnswers = GM_getValue('correctAnswers', []);
const knownWords = new Set(correctAnswers);

function addWord(word) {
    const clean = word.trim().toLowerCase();
    if (!clean || knownWords.has(clean)) return false;
    knownWords.add(clean);
    correctAnswers.push(clean);
    return true;
}

async function fetchWords(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Erreur de chargement de la liste de mots.');

        const data = await response.text();
        return data.split('\n').map((word) => word.trim().toLowerCase()).filter(Boolean);
    } catch (error) {
        console.error('[Skribbl Assistant] Récupération des mots impossible :', error);
        return [];
    }
}

async function fetchAndStoreLatestWordlist() {
    const words = await fetchWords(WORDLIST_URL);
    let added = 0;
    words.forEach((word) => { if (addWord(word)) added++; });

    if (added) GM_setValue('correctAnswers', correctAnswers);
    console.log(`[Skribbl Assistant] ${correctAnswers.length} mots en base (+${added}).`);
    refresh();
}


/* ════════════════════════════ Détection du pseudo ════════════════════════════ */

let myUsername = '';

async function findUsername() {
    const target = await waitFor('.players-list');
    if (!target) return;

    // Recherche limitée à la liste des joueurs : « .me » seul, à l'échelle du
    // document, risquerait de désigner un tout autre élément — et donc de faire
    // passer le script en pause pendant le tour de quelqu'un d'autre.
    const readMe = () => {
        const meElement = target.querySelector('.player.me .player-name')
            || target.querySelector('.player.me')
            || target.querySelector('.me');
        if (!meElement) return false;

        const name = meElement.textContent.replace(/\s*\((?:You|Vous)\)\s*$/i, '').trim();
        if (!name) return false;

        myUsername = name;
        return true;
    };

    if (readMe()) return;

    const observer = new MutationObserver(() => { if (readMe()) observer.disconnect(); });
    observer.observe(target, { childList: true, subtree: true });
}


/* ════════════════════════════ Filtrage par les indices ════════════════════════════ */

let possibleWords = [];
let previousWords = [];
let lastInstantWord = '';

function filterHints(inputWords) {
    const hints = Array.from(document.querySelectorAll('.hints .hint'));
    if (!hints.length) return inputWords;

    // Mot entièrement révélé : on l'apprend et on vide les suggestions.
    const allUncovered = hints.every((elem) => elem.classList.contains('uncover'));
    if (allUncovered) {
        const correctAnswer = hints.map((elem) => elem.textContent).join('').toLowerCase();

        if (knownWords.has(correctAnswer)) {
            // Remonte le mot dans la liste : les mots déjà vus ressortent en premier.
            const currentIndex = correctAnswers.indexOf(correctAnswer);
            if (currentIndex > 0) {
                correctAnswers.splice(currentIndex, 1);
                correctAnswers.splice(currentIndex - 1, 0, correctAnswer);
            }
        } else {
            addWord(correctAnswer);
            console.log(`[Skribbl Assistant] Nouveau mot appris : ${correctAnswer}`);
        }

        GM_setValue('correctAnswers', correctAnswers);

        // Le tour est fini : sans ce reset, un « X est proche » au tour suivant
        // repêcherait des mots filtrés pour le mot précédent.
        previousWords = [];
        lastInstantWord = '';
        return [];
    }

    const hintPattern = hints
        .map((hint) => (hint.textContent === '_' ? LETTER : escapeRegex(hint.textContent)))
        .join('');

    let hintRegex;
    try {
        hintRegex = new RegExp(`^${hintPattern}$`, 'iu');
    } catch (error) {
        console.warn('[Skribbl Assistant] Motif d\'indice invalide :', hintPattern, error);
        return inputWords;
    }

    return inputWords.filter((word) => hintRegex.test(word));
}

async function observeHints() {
    const target = await waitFor('.hints .container');
    if (!target) return;

    const observer = new MutationObserver(() => {
        possibleWords = filterHints(possibleWords);
        refresh();
    });

    observer.observe(target, { childList: true, subtree: true });
}


/* ════════════════════════════ Mots proposés au dessinateur ════════════════════════════ */

async function observeDrawingTurn() {
    const target = await waitFor('.words');
    if (!target) return;

    const observer = new MutationObserver(() => {
        let added = 0;
        target.childNodes.forEach((word) => {
            if (addWord(word.textContent || '')) added++;
        });
        if (added) GM_setValue('correctAnswers', correctAnswers);
    });

    observer.observe(target, { childList: true });
}


/* ════════════════════════════ Analyse du chat ════════════════════════════ */

// https://youtu.be/Dd_NgYVOdLk
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Skribbl affiche ces messages en anglais ou en français selon la langue du client.
// Le nom du dessinateur est capturé : c'est lui qui décide de la mise en pause.
const DRAWING_RE = /^(.+?)\s+(?:is drawing now\s*!?|dessine maintenant\s*!?|est en train de dessiner\s*!?)\s*$/i;
const CLOSE_RE = /^(.+?)\s+(?:is close!|est proche\s*!?)\s*$/i;

function handleChatMessage(messageNode) {
    const message = messageNode.textContent.trim();

    const drawingMatch = message.match(DRAWING_RE);
    if (drawingMatch) {
        currentDrawer = drawingMatch[1].trim();
        lastInstantWord = '';
        possibleWords = filterHints(correctAnswers.slice());
        previousWords = possibleWords;
        syncPausedState();
        refresh();
        return;
    }

    // Les comparaisons se font sans accents : un joueur qui tape "elephant"
    // doit bien écarter "éléphant" de la liste.
    const closeMatch = message.match(CLOSE_RE);
    if (closeMatch) {
        const closeKey = strip(closeMatch[1].toLowerCase());
        possibleWords = previousWords.filter((word) => levenshteinDistance(strip(word), closeKey) === 1);
        refresh();
        return;
    }

    const separator = message.indexOf(': ');
    if (separator > 0) {
        const username = message.slice(0, separator);
        const guessKey = strip(message.slice(separator + 2).toLowerCase());

        possibleWords = possibleWords.filter((word) => strip(word) !== guessKey);
        previousWords = possibleWords;

        // Mes propres essais ratés : skribbl aurait dit "proche", donc on écarte aussi les voisins.
        if (username === myUsername) {
            possibleWords = possibleWords.filter((word) => levenshteinDistance(strip(word), guessKey) > 1);
        }

        refresh();
    }
}

async function observeChat() {
    const target = await waitFor('.chat-content');
    if (!target) return;

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) handleChatMessage(node);
            });
        });
    });

    observer.observe(target, { childList: true });
}


/* ════════════════════════════ Envoi ════════════════════════════ */

function submitGuess(word) {
    const input = chatInput();
    const form = chatForm();
    if (!input || !form) {
        console.warn('[Skribbl Assistant] Champ de chat introuvable.');
        return false;
    }

    input.value = word;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    input.value = '';
    updateGhost(null);
    return true;
}

// Réponse automatique instantanée : UNIQUEMENT si le mode Auto est activé.
// C'était le bug de la v1.00 : un seul mot restant déclenchait l'envoi même Auto désactivé.
function maybeInstantSubmit() {
    if (!settings.autoGuess) return;
    if (isDrawing()) return;
    if (possibleWords.length !== 1) return;

    const word = possibleWords[0];
    if (word === lastInstantWord) return;

    lastInstantWord = word;
    if (submitGuess(word)) possibleWords.shift();
}

let autoTimer = null;

function stopAutoGuessing() {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
}

// Délai tiré au hasard dans la plage choisie, pour chaque envoi.
function nextAutoDelay() {
    const [min, max] = RANGES[settings.autoRange] || RANGES[DEFAULTS.autoRange];
    return min + Math.random() * (max - min);
}

// setTimeout reprogrammé plutôt que setInterval : c'est ce qui permet de faire
// varier l'attente d'un envoi au suivant.
function startAutoGuessing() {
    stopAutoGuessing();
    if (!settings.autoGuess) return;

    const tick = () => {
        if (!settings.autoGuess) return;

        if (!isDrawing() && possibleWords.length && submitGuess(possibleWords[0])) {
            possibleWords.shift();
            refresh();
        }

        autoTimer = setTimeout(tick, nextAutoDelay());
    };

    autoTimer = setTimeout(tick, nextAutoDelay());
}


/* ════════════════════════════ Rendu des suggestions ════════════════════════════ */

// Un mot envoyé est consommé, qu'il parte d'un clic ou du mode Auto :
// sinon on reclique sur une suggestion déjà tentée sans s'en rendre compte.
function pickWord(word) {
    if (!submitGuess(word)) return;
    possibleWords = possibleWords.filter((candidate) => candidate !== word);
    refresh();
}

// Après un changement de mode, on repart du début de la liste.
// (scrollIntoView est à éviter ici : il ferait défiler la page du jeu.)
function scrollTopIntoView() {
    bodyElem.scrollLeft = 0;
    bodyElem.scrollTop = 0;
}

function renderGuesses(words, key = '') {
    bodyElem.innerHTML = '';

    if (!words.length) {
        const empty = document.createElement('div');
        empty.className = 'sa-empty';
        empty.textContent = isPaused
            ? 'À vous de dessiner…'
            : 'En attente des indices…';
        bodyElem.appendChild(empty);
        return;
    }

    // En mode une ligne, inutile d'aligner 200 pastilles dans une bande à faire
    // défiler indéfiniment : on en montre moins et le total reste indiqué à droite.
    const limit = isExpanded() ? MAX_CHIPS : COMPACT_CHIPS;

    words.slice(0, limit).forEach((word, index) => {
        const chip = document.createElement('div');
        chip.className = index === 0 ? 'sa-chip sa-chip--top' : 'sa-chip';

        // Ce que vous avez déjà tapé est grisé : seule la fin du mot ressort.
        // En recherche floue, seules les vraies correspondances de début sont grisées.
        const cut = key && strip(word).startsWith(key) ? Math.min(key.length, word.length) : 0;
        if (cut > 0) {
            const done = document.createElement('span');
            done.className = 'sa-chip-typed';
            done.textContent = word.slice(0, cut);
            chip.appendChild(done);
        }
        chip.appendChild(document.createTextNode(word.slice(cut)));

        chip.title = 'Cliquer pour envoyer';
        chip.tabIndex = 0;
        chip.setAttribute('role', 'button');
        chip.addEventListener('click', () => pickWord(word));
        chip.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                pickWord(word);
            }
        });
        bodyElem.appendChild(chip);
    });

    if (words.length > limit) {
        const more = document.createElement('div');
        more.className = 'sa-more';
        more.textContent = `+ ${words.length - limit}`;
        more.title = `${words.length - limit} autres mots — cliquez sur ▴ pour tout voir`;
        bodyElem.appendChild(more);
    }
}

// Pendant votre tour de dessin le script ne devine rien : on le dit clairement,
// sinon le panneau vide donne l'impression d'être cassé.
let isPaused = false;

function syncPausedState() {
    const paused = isDrawing();
    if (paused === isPaused) return;
    isPaused = paused;
    if (!paused) pauseFoldOverride = false;   // fin de votre tour : repli de nouveau automatique
    panel.dataset.paused = String(paused);
    syncControls();
    refresh();
}

// Correspondance entre ce que vous tapez et un mot : le rang sert à classer les
// résultats, le préfixe exact restant toujours devant. -1 = pas de correspondance.
function matchRank(word, key) {
    const candidate = strip(word);
    if (candidate.startsWith(key)) return 0;
    if (!settings.fuzzy) return -1;
    if (candidate.includes(key)) return 1;
    // Une faute de frappe tolérée, mais seulement au-delà de 3 lettres :
    // en dessous, la distance de 1 laisserait passer presque tout.
    if (key.length >= 3 && levenshteinDistance(candidate.slice(0, key.length), key) === 1) return 2;
    return -1;
}

function computeMatches() {
    const input = chatInput();
    const typed = input ? input.value.toLowerCase().trim() : '';
    const key = strip(typed);
    if (!key) return { key: '', matches: possibleWords.slice() };

    const ranked = [];
    possibleWords.forEach((word) => {
        const rank = matchRank(word, key);
        if (rank >= 0) ranked.push({ word, rank });
    });

    ranked.sort((a, b) => a.rank - b.rank);   // tri stable : l'ordre d'origine tient à rang égal
    return { key, matches: ranked.map((entry) => entry.word) };
}

// Nombre de lettres du mot cherché, déduit des cases d'indice.
function hintStats() {
    const hints = Array.from(document.querySelectorAll('.hints .hint'));
    if (!hints.length) return null;

    let total = 0;
    let revealed = 0;
    hints.forEach((hint) => {
        const char = hint.textContent;
        if (!char.trim()) return;          // séparateur d'un mot composé
        total++;
        if (char !== '_') revealed++;
    });

    return total ? { total, revealed } : null;
}

function refresh() {
    // On consomme d'abord un éventuel envoi automatique : le rendu reflète ainsi
    // la liste réelle, sans laisser affiché un mot déjà parti dans le chat.
    maybeInstantSubmit();

    const { key, matches } = computeMatches();

    countElem.dataset.paused = String(isPaused);
    countElem.textContent = isPaused
        ? 'en pause · votre tour'
        : `${matches.length} mot${matches.length > 1 ? 's' : ''}`;

    const stats = isPaused ? null : hintStats();
    lettersElem.textContent = stats
        ? `${stats.total} lettres${stats.revealed ? ` · ${stats.revealed} révélée${stats.revealed > 1 ? 's' : ''}` : ''}`
        : '';

    renderGuesses(matches, key);
    updateGhost(matches[0]);
}



/* ════════════════════════════ Complétion dans le champ ════════════════════════════ */

let ghostElem = null;

function textWidth(text, refElem) {
    const style = window.getComputedStyle(refElem);
    const canvas = textWidth._canvas || (textWidth._canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(text).width;
}

function updateGhost(bestMatch) {
    const input = chatInput();
    if (!ghostElem || !input) return;

    const typed = input.value;
    if (!typed.trim() || !bestMatch || bestMatch.length <= typed.length) {
        ghostElem.textContent = '';
        return;
    }

    // L'aperçu se colle à la fin de ce qui est tapé : il n'a de sens que si le mot
    // commence vraiment par là. En recherche floue, ce n'est plus garanti.
    if (!strip(bestMatch).startsWith(strip(typed.toLowerCase().trim()))) {
        ghostElem.textContent = '';
        return;
    }

    ghostElem.textContent = bestMatch.slice(typed.length);

    const style = window.getComputedStyle(input);
    ghostElem.style.font = style.font;
    ghostElem.style.fontSize = style.fontSize;
    ghostElem.style.fontFamily = style.fontFamily;
    ghostElem.style.top = `${input.offsetTop}px`;
    ghostElem.style.height = `${input.offsetHeight}px`;
    ghostElem.style.lineHeight = `${input.offsetHeight}px`;
    ghostElem.style.left = `${input.offsetLeft + parseFloat(style.paddingLeft || 0) + textWidth(typed, input) - input.scrollLeft}px`;
}

function setupInput(input) {
    ghostElem = document.createElement('span');
    ghostElem.className = 'sa-ghost';

    const parent = input.parentNode;
    if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(ghostElem);

    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', refresh);
    input.addEventListener('scroll', () => updateGhost(currentBest()));

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
            const best = currentBest();
            if (!best) return;
            event.preventDefault();
            input.value = best;          // mot complet : garde les accents corrects
            refresh();
            return;
        }

        // Entrée envoie normalement ce que VOUS avez tapé.
        // La 1re suggestion n'est envoyée que si l'option "Entrée" est activée.
        if (event.key === 'Enter' && settings.enterFill) {
            const best = currentBest();
            if (!best) return;
            event.preventDefault();
            pickWord(best);
        }
    });
}

function currentBest() {
    // Même source que les suggestions affichées : Tab complète toujours
    // exactement la pastille mise en avant.
    return computeMatches().matches[0] || null;
}


/* ════════════════════════════ Export ════════════════════════════ */

async function exportNewWords() {
    exportBtn.disabled = true;
    const original = exportBtn.textContent;
    exportBtn.textContent = '⏳ Export…';

    try {
        const old = new Set(await fetchWords(WORDLIST_URL));
        const newWords = correctAnswers.filter((word) => !old.has(word));

        const blob = new Blob([newWords.join('\n')], { type: 'text/plain;charset=utf-8' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = 'newWords.txt';

        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(anchor.href);

        exportBtn.textContent = `✓ ${newWords.length} mot${newWords.length > 1 ? 's' : ''}`;
    } catch (error) {
        console.error('[Skribbl Assistant] Export impossible :', error);
        exportBtn.textContent = '✗ Échec';
    }

    setTimeout(() => { exportBtn.textContent = original; exportBtn.disabled = false; }, 2000);
}


/* ════════════════════════════ Contrôles ════════════════════════════ */

autoBtn.addEventListener('click', () => {
    setSetting('autoGuess', !settings.autoGuess);
    lastInstantWord = '';
    syncControls();
    startAutoGuessing();
});

enterBtn.addEventListener('click', () => {
    setSetting('enterFill', !settings.enterFill);
    syncControls();
});

fuzzyBtn.addEventListener('click', () => {
    setSetting('fuzzy', !settings.fuzzy);
    syncControls();
    refresh();
});

foldBtn.addEventListener('click', () => {
    setSetting('autoCollapse', !settings.autoCollapse);
    syncControls();
});

delaySel.addEventListener('change', () => {
    if (RANGES[delaySel.value]) setSetting('autoRange', delaySel.value);
    startAutoGuessing();
});

toggleBtn.addEventListener('click', () => {
    // Pendant votre tour, le repli forcé masque votre réglage : le premier clic
    // le lève, plutôt que de basculer un réglage qui semblerait sans effet.
    if (settings.expanded && !isExpanded()) {
        pauseFoldOverride = true;
    } else {
        setSetting('expanded', !settings.expanded);
        if (isPaused) pauseFoldOverride = settings.expanded;
    }

    syncControls();
    refresh();              // le nombre de pastilles affichées dépend du mode
    scrollTopIntoView();
});

exportBtn.addEventListener('click', exportNewWords);


/* ════════════════════════════ Démarrage ════════════════════════════ */

async function init() {
    syncControls();
    renderGuesses([]);
    fetchAndStoreLatestWordlist();

    const input = await waitFor('#game-chat input[data-translate="placeholder"]');
    if (!input) {
        console.warn('[Skribbl Assistant] Chat introuvable : le script reste inactif.');
        return;
    }

    setupInput(input);
    findUsername();
    observeChat();
    observeHints();
    observeDrawingTurn();
    startAutoGuessing();

    console.log('[Skribbl Assistant] Prêt. Réponse automatique :', settings.autoGuess ? 'ACTIVÉE' : 'DÉSACTIVÉE');
}

init();

})();
