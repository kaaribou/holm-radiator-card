/* holm-radiator-card — https://github.com/kaaribou/holm-radiator-card — licence MIT — v1.0.0 */
/* HOLM Radiator Card — v2
 * Carte pour radiateurs électriques fil pilote (select Off/Comfort/Eco/
 * Anti-freeze/Comfort-1/Comfort-2) ou entité climate à préréglages.
 * - Ambiance selon le mode : Confort (lueur chaude + ondes de chaleur),
 *   Confort -1/-2 (ambre, plus doux), Éco (vert apaisé), Hors-gel (givre),
 *   Arrêt (sobre). Animation pleine quand le radiateur consomme réellement.
 * - Puissance instantanée, énergie du jour (statistiques natives) et
 *   température de la pièce détectées automatiquement (appareil / pièce).
 * - Deux mises en page : "card" (défaut, 6 colonnes) et "compact" (1 ligne).
 */
(() => {
  const MODES = {
    off: { icon: "mdi:power", rgb: "150,160,178", label: "Arrêt", short: "Arrêt" },
    eco: { icon: "mdi:leaf", rgb: "62,207,142", label: "Éco", short: "Éco" },
    comfort: { icon: "mdi:fire", rgb: "255,122,40", label: "Confort", short: "Confort" },
    comfort1: { icon: "mdi:fire", rgb: "255,160,60", label: "Confort −1°", short: "Conf. −1" },
    comfort2: { icon: "mdi:fire", rgb: "255,190,90", label: "Confort −2°", short: "Conf. −2" },
    frost: { icon: "mdi:snowflake-thermometer", rgb: "110,200,255", label: "Hors-gel", short: "H-gel" },
  };
  const MAIN = ["off", "frost", "eco", "comfort2", "comfort1", "comfort"];
  const COMFORTS = ["comfort", "comfort1", "comfort2"];
  const FIN_GRAD = {
    off: ["#3a4150", "#2a303c"],
    eco: ["#8ef0c0", "#22a86e"],
    comfort: ["#ffd08a", "#ff5a1f"],
    comfort1: ["#ffdc9c", "#ff8a2e"],
    comfort2: ["#ffe6b0", "#ffac48"],
    frost: ["#e2f6ff", "#5aa8ff"],
  };
  const norm = (o) => {
    const s = String(o || "").toLowerCase().replace(/[\s_]/g, "-");
    if (s === "off" || s === "arret" || s === "arrêt" || s === "none") return "off";
    if (s === "comfort-1" || s === "confort-1") return "comfort1";
    if (s === "comfort-2" || s === "confort-2") return "comfort2";
    if (s.startsWith("comfort") || s.startsWith("confort")) return "comfort";
    if (s.startsWith("eco")) return "eco";
    if (s.includes("freeze") || s.includes("frost") || s.includes("gel") || s === "away") return "frost";
    return null;
  };
  const OPT_TTL = 15000;
  const ACTIVE_W = 5;

  const fmtN = (v, d = 0) => Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPower = (w) => (w == null || isNaN(w) ? "–" : w >= 1000 ? `${fmtN(w / 1000, 2)} kW` : `${fmtN(w)} W`);
  const fmtEnergy = (k) => (k == null || isNaN(k) ? "–" : k < 1 ? `${fmtN(k * 1000)} Wh` : `${fmtN(k, k < 10 ? 2 : 1)} kWh`);

  // Radiateur illustré : 7 ailettes + ondes
  const FINS = Array.from({ length: 7 }, (_, i) => {
    const x = 10 + i * 15;
    return `<rect class="fin" x="${x}" y="34" width="11" height="50" rx="5.5"/><rect class="shine" x="${x + 2.5}" y="39" width="2.2" height="40" rx="1.1"/>`;
  }).join("");
  const WAVES = [0, 1, 2, 3].map((i) => {
    const x = 22 + i * 25;
    return `<path class="wave w${i}" d="M${x} 30 q-5 -6 0 -12 q5 -6 0 -12"/>`;
  }).join("");

  class HolmRadiatorCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("holm-radiator-card-editor");
    }
    static getStubConfig(hass) {
      const e = hass ? Object.keys(hass.states).find((k) => k.startsWith("select.") && (hass.states[k].attributes.options || []).some((o) => norm(o) === "comfort")) : "";
      return { type: "custom:holm-radiator-card", entity: e || "" };
    }
    setConfig(config) {
      if (!config || !config.entity) throw new Error("Choisis l'entité du radiateur (select fil pilote ou climate).");
      this._config = { layout: "card", show_power: true, show_energy: true, show_temperature: true, ...config };
      this._opt = null;
      this._auto = null;
      this._energyToday = null;
      this._energyTs = 0;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._built = false;
      if (this._hass) this.hass = this._hass;
    }
    getCardSize() {
      return this._config && this._config.layout === "compact" ? 1 : 4;
    }
    getGridOptions() {
      return this._config && this._config.layout === "compact" ? { columns: 12, min_columns: 6, rows: 1 } : { columns: 6, min_columns: 6, rows: "auto" };
    }
    connectedCallback() {
      if (this._hass && this._built) this._fetchEnergy(true);
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      this._so = hass.states[this._config.entity];
      if (!this._auto) this._detect();
      if (this._opt && (this._rawMode() === this._opt.v || Date.now() - this._opt.ts > OPT_TTL)) this._opt = null;
      if (!this._built) this._build();
      this._render();
      this._fetchEnergy(false);
    }

    // ---------- détection automatique ----------
    _detect() {
      const h = this._hass;
      const cfg = this._config;
      const ents = h.entities || {};
      const devs = h.devices || {};
      const me = ents[cfg.entity];
      const dev = me && me.device_id;
      const area = (me && me.area_id) || (dev && devs[dev] && devs[dev].area_id) || null;
      const dc = (id) => (h.states[id] && h.states[id].attributes.device_class) || "";
      const sameDev = dev ? Object.keys(ents).filter((id) => ents[id].device_id === dev && h.states[id]) : [];
      const pick = (list, cls, suffix) => list.find((id) => dc(id) === cls) || list.find((id) => id.endsWith(suffix));
      let temp = null;
      if (area) {
        const inArea = Object.keys(ents).filter((id) => {
          if (!id.startsWith("sensor.") || !h.states[id]) return false;
          const e = ents[id];
          const a = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
          return a === area && dc(id) === "temperature" && !/outdoor|exterieur|extérieur|_ext|cpu|battery|batterie/i.test(id + (h.states[id].attributes.friendly_name || ""));
        });
        temp = inArea.find((id) => /temp/i.test(id)) || inArea[0] || null;
      }
      this._auto = {
        power: cfg.power_entity || pick(sameDev, "power", "_power") || null,
        energy: cfg.energy_entity || pick(sameDev, "energy", "_energy") || null,
        temp: cfg.temperature_entity || temp,
      };
    }

    // ---------- état ----------
    _isClimate() {
      return this._config.entity.startsWith("climate.");
    }
    _options() {
      const a = this._so ? this._so.attributes : {};
      return (this._isClimate() ? a.preset_modes : a.options) || [];
    }
    _rawMode() {
      const so = this._so;
      if (!so) return null;
      if (this._isClimate()) return so.state === "off" ? (this._options().find((o) => norm(o) === "off") || "off") : so.attributes.preset_mode;
      return so.state;
    }
    _mode() {
      return norm(this._opt ? this._opt.v : this._rawMode()) || "off";
    }
    _optionFor(key) {
      return this._options().find((o) => norm(o) === key);
    }
    _setMode(key) {
      const opt = this._optionFor(key);
      const h = this._hass;
      if (!h) return;
      if (!opt && !(key === "off" && this._isClimate())) return;
      this._opt = { v: opt || "off", ts: Date.now() };
      const id = this._config.entity;
      if (this._isClimate()) {
        const so = this._so;
        const modes = so.attributes.hvac_modes || [];
        if (key === "off" && modes.includes("off")) h.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: "off" });
        else {
          if (so.state === "off" && modes.includes("heat")) h.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: "heat" });
          if (opt) h.callService("climate", "set_preset_mode", { entity_id: id, preset_mode: opt });
        }
      } else {
        h.callService(id.split(".")[0], "select_option", { entity_id: id, option: opt });
      }
      this._render();
    }
    _num(id) {
      const s = id && this._hass.states[id];
      if (!s || isNaN(parseFloat(s.state))) return null;
      return parseFloat(s.state);
    }
    _power() {
      const id = this._auto.power;
      const v = this._num(id);
      if (v == null) return null;
      const u = this._hass.states[id].attributes.unit_of_measurement;
      return u === "kW" ? v * 1000 : v;
    }
    async _fetchEnergy(force) {
      const id = this._auto && this._auto.energy;
      if (!id || !this._config.show_energy || !this._hass.callWS) return;
      if (!force && Date.now() - this._energyTs < 300000) return;
      this._energyTs = Date.now();
      try {
        const r = await this._hass.callWS({ type: "recorder/statistic_during_period", statistic_id: id, calendar: { period: "day" }, types: ["change"] });
        const u = this._hass.states[id] && this._hass.states[id].attributes.unit_of_measurement;
        let k = r && r.change != null ? Number(r.change) : null;
        if (k != null && u === "Wh") k /= 1000;
        if (k != null && u === "MWh") k *= 1000;
        this._energyToday = k;
        this._render();
      } catch (e) {
        this._energyToday = null;
      }
    }

    // ---------- DOM ----------
    _build() {
      const root = this.shadowRoot;
      root.innerHTML = "";
      const st = document.createElement("style");
      st.textContent = HolmRadiatorCard.css();
      root.appendChild(st);
      const parts = Array.from({ length: 12 }, (_, i) => {
        const x = ((i * 41) % 100);
        return `<i style="left:${x}%;--d:${3.4 + ((i * 13) % 9) / 3}s;--dl:${-((i * 7) % 19) / 3}s;--s:${3 + ((i * 5) % 3)}px;--dx:${((i % 5) - 2) * 7}px"></i>`;
      }).join("");
      const compact = this._config.layout === "compact";
      const card = document.createElement("ha-card");
      card.className = compact ? "compact" : "";
      card.innerHTML = compact
        ? `
        <div class="amb"><div class="glow"></div></div>
        <div class="row">
          <div class="badge" id="head"><ha-icon id="bicon"></ha-icon></div>
          <div class="ttl" id="head2">
            <div class="name" id="name"></div>
            <div class="status"><span class="dot"></span><span id="status"></span></div>
          </div>
          <div class="modes sm" id="modes"></div>
        </div>
        <div class="na" id="na">Indisponible</div>`
        : `
        <div class="amb"><div class="glow"></div><div class="fx">${parts}</div></div>
        <div class="wrap">
          <div class="head" id="head">
            <div class="badge"><ha-icon id="bicon"></ha-icon></div>
            <div class="ttl">
              <div class="name" id="name"></div>
              <div class="status"><span class="dot"></span><span id="status"></span></div>
            </div>
          </div>
          <div class="main">
            <div class="hero">
              <svg viewBox="0 0 120 92" class="rad">
                <defs><linearGradient id="fg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" id="f0"/><stop offset="1" id="f1"/></linearGradient></defs>
                <g class="waves">${WAVES}</g>
                <rect class="pipe" x="6" y="40" width="108" height="5" rx="2.5"/>
                <rect class="pipe" x="6" y="73" width="108" height="5" rx="2.5"/>
                <g class="fins">${FINS}</g>
                <rect class="foot" x="14" y="84" width="6" height="6" rx="2"/><rect class="foot" x="100" y="84" width="6" height="6" rx="2"/>
              </svg>
              <div class="mlabel" id="mlabel"></div>
            </div>
            <div class="side">
              <div class="stats" id="stats"></div>
              <div class="modes" id="modes"></div>
            </div>
          </div>
        </div>
        <div class="na" id="na">Radiateur indisponible</div>`;
      root.appendChild(card);
      this._card = card;
      this.$ = (id) => root.getElementById(id);
      const more = () => this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._config.entity }, bubbles: true, composed: true }));
      ["head", "head2"].forEach((id) => this.$(id) && this.$(id).addEventListener("click", more));
      this._built = true;
    }

    _render() {
      const $ = this.$;
      const card = this._card;
      const so = this._so;
      const cfg = this._config;
      $("name").textContent = cfg.name || (so && so.attributes.friendly_name ? so.attributes.friendly_name.replace(/ mode$/i, "") : cfg.entity);
      if (!so || so.state === "unavailable" || so.state === "unknown") {
        card.classList.add("unavail");
        return;
      }
      card.classList.remove("unavail");
      const mode = this._mode();
      const m = MODES[mode];
      const p = cfg.show_power ? this._power() : null;
      const hasPower = cfg.show_power && this._auto.power && this._hass.states[this._auto.power];
      const active = mode !== "off" && (hasPower && p != null ? p > ACTIVE_W : true);
      card.dataset.mode = mode;
      card.dataset.fx = mode === "off" ? "none" : COMFORTS.includes(mode) ? "heat" : mode;
      card.classList.toggle("active", active);
      card.classList.toggle("on", mode !== "off");
      card.style.setProperty("--m", m.rgb);
      $("bicon").setAttribute("icon", mode === "off" ? (cfg.icon || "mdi:radiator-off") : cfg.icon || "mdi:radiator");

      let status = this._opt ? m.label + "…" : m.label;
      if (mode !== "off" && hasPower && p != null) status += p > ACTIVE_W ? ` · ${fmtPower(p)}` : " · en attente";
      $("status").textContent = status;

      if (!$("mlabel")) {
        this._renderModes(mode, true);
        return;
      }
      $("mlabel").innerHTML = `<ha-icon icon="${m.icon}"></ha-icon><span>${m.label}</span>`;
      const g = FIN_GRAD[mode];
      $("f0").setAttribute("stop-color", g[1]);
      $("f1").setAttribute("stop-color", g[0]);

      // stats
      const stats = [];
      if (hasPower) stats.push({ icon: "mdi:flash", v: fmtPower(p || 0), t: "Puissance", hot: p > ACTIVE_W });
      if (cfg.show_energy && this._auto.energy) stats.push({ icon: "mdi:lightning-bolt-circle", v: fmtEnergy(this._energyToday), t: "Aujourd'hui" });
      const tv = cfg.show_temperature ? (this._isClimate() && so.attributes.current_temperature != null ? so.attributes.current_temperature : this._num(this._auto.temp)) : null;
      if (tv != null) stats.push({ icon: "mdi:home-thermometer-outline", v: `${fmtN(tv, 1)}°`, t: "Pièce" });
      const sb = $("stats");
      sb.style.display = stats.length ? "" : "none";
      sb.dataset.n = stats.length;
      sb.innerHTML = stats.map((s) => `<div class="stat${s.hot ? " hot" : ""}" title="${s.t}"><ha-icon icon="${s.icon}"></ha-icon><b>${s.v}</b><small>${s.t}</small></div>`).join("");

      this._renderModes(mode, false);
    }

    _renderModes(mode, compact) {
      const box = this.$("modes");
      const list = MAIN.filter((k) => k === "off" || this._optionFor(k));
      box.dataset.n = list.length;
      const key = list.join(",") + "|" + mode;
      if (box._key === key) return;
      box._key = key;
      box.innerHTML = "";
      list.forEach((k) => {
        const mm = MODES[k];
        const on = k === mode;
        const b = document.createElement("button");
        b.className = "mode" + (on ? " on" : "") + (k === "comfort1" || k === "comfort2" ? " sub" : "");
        b.style.setProperty("--c", mm.rgb);
        b.title = mm.label;
        const tag = compact && (k === "comfort1" || k === "comfort2") ? `<em>${k === "comfort1" ? "−1" : "−2"}</em>` : "";
        b.innerHTML = `<ha-icon icon="${mm.icon}"></ha-icon><span>${mm.short}</span>${tag}`;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (k === mode) return;
          this._setMode(k);
        });
        box.appendChild(b);
      });
    }

    static css() {
      return `
      :host { display: block; height: 100%; }
      ha-card {
        display: block; --m: 150,160,178;
        --tx: #e6f2f5;
        --tx2: rgba(220,235,240,.62);
        position: relative; overflow: hidden; height: 100%; box-sizing: border-box;
        container-type: inline-size;
        border-radius: var(--ha-card-border-radius, 20px);
        background: linear-gradient(160deg, rgba(20,28,38,.92), rgba(10,15,22,.96));
        border: 1px solid rgba(var(--m), .18);
        box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04);
        color: var(--tx); user-select: none; -webkit-tap-highlight-color: transparent;
        transition: border-color .6s, box-shadow .6s;
      }
      ha-card.active { box-shadow: 0 10px 30px rgba(0,0,0,.35), 0 0 22px -6px rgba(var(--m), .45), inset 0 1px 0 rgba(255,255,255,.05); }
      button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; -webkit-tap-highlight-color: transparent; }

      /* ambiance */
      .amb { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
      .glow { position: absolute; inset: 0; opacity: .35; transition: opacity .8s; }
      ha-card[data-fx="heat"] .glow { background: radial-gradient(130% 75% at 50% 110%, rgba(var(--m),.55), rgba(var(--m),.14) 55%, transparent 78%); }
      ha-card[data-fx="eco"] .glow { background: radial-gradient(120% 70% at 50% 105%, rgba(62,207,142,.4), rgba(62,207,142,.08) 55%, transparent 75%); }
      ha-card[data-fx="frost"] .glow { background: radial-gradient(120% 70% at 50% -10%, rgba(120,205,255,.45), rgba(90,160,255,.1) 55%, transparent 75%); }
      ha-card.active .glow { opacity: .85; animation: breathe 5s ease-in-out infinite; }
      ha-card.active[data-fx="eco"] .glow { animation-duration: 8s; }
      @keyframes breathe { 50% { opacity: .55; } }
      .fx { position: absolute; inset: 0; opacity: 0; transition: opacity 1s; }
      ha-card.active .fx { opacity: 1; }
      .fx i { position: absolute; width: var(--s); height: var(--s); border-radius: 50%; opacity: 0; }
      ha-card.active[data-fx="heat"] .fx i { bottom: -8px; background: radial-gradient(circle, #ffe0a0, rgb(var(--m)) 60%, transparent 70%); box-shadow: 0 0 6px 1px rgba(var(--m),.7); animation: rise var(--d) ease-in var(--dl) infinite; }
      ha-card.active[data-fx="eco"] .fx i { bottom: -8px; background: radial-gradient(circle, #d6ffe9, #3ecf8e 60%, transparent 72%); animation: rise calc(var(--d) * 2) ease-in-out var(--dl) infinite; }
      ha-card.active[data-fx="eco"] .fx i:nth-child(2n) { display: none; }
      ha-card.active[data-fx="frost"] .fx i { top: -8px; background: radial-gradient(circle, #fff, #bfe9ff 55%, transparent 72%); box-shadow: 0 0 5px rgba(170,225,255,.8); animation: fall calc(var(--d) * 1.6) linear var(--dl) infinite; }
      @keyframes rise { 0% { transform: translate(0,0) scale(1); opacity: 0; } 12% { opacity: .9; } 100% { transform: translate(var(--dx), -280px) scale(.3); opacity: 0; } }
      @keyframes fall { 0% { transform: translate(0,0); opacity: 0; } 12% { opacity: .85; } 50% { transform: translate(var(--dx), 160px); } 100% { transform: translate(calc(var(--dx) * -1), 320px); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .fx { display: none; } .glow, .wave, .fin, .badge ha-icon { animation: none !important; } }

      /* entête */
      .wrap { position: relative; padding: 12px; display: flex; flex-direction: column; gap: 8px; height: 100%; box-sizing: border-box; }
      .head { display: flex; align-items: center; gap: 9px; min-width: 0; cursor: pointer; }
      .badge { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: rgba(var(--m), .16); color: rgb(var(--m)); box-shadow: inset 0 0 0 1px rgba(var(--m), .25); transition: background .5s, color .5s; cursor: pointer; }
      .badge ha-icon { --mdc-icon-size: 20px; }
      ha-card.active[data-fx="heat"] .badge ha-icon { animation: warm 2.4s ease-in-out infinite; }
      @keyframes warm { 50% { filter: drop-shadow(0 0 6px rgba(var(--m), .95)); transform: translateY(-1px); } }
      .ttl { min-width: 0; flex: 1; cursor: pointer; }
      .name { font-size: 14px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .status { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--tx2); margin-top: 2px; white-space: nowrap; overflow: hidden; }
      .status span:last-child { overflow: hidden; text-overflow: ellipsis; }
      .dot { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: rgba(var(--m), .7); }
      ha-card.active .dot { background: rgb(var(--m)); box-shadow: 0 0 6px rgb(var(--m)); animation: pulse 1.8s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .35; } }

      /* héros radiateur */
      .main { display: flex; flex-direction: column; gap: 10px; flex: 1; }
      .hero { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .rad { width: 100%; max-width: 150px; height: auto; overflow: visible; }
      .pipe, .foot { fill: rgba(255,255,255,.12); }
      ha-card.on .pipe { fill: rgba(var(--m), .35); }
      .fin { fill: url(#fg); stroke: rgba(255,255,255,.08); stroke-width: .6; transition: filter .6s; }
      ha-card.active .fin { filter: drop-shadow(0 0 4px rgba(var(--m), .7)); animation: finglow 3s ease-in-out infinite; }
      ha-card.active[data-fx="eco"] .fin { animation-duration: 6s; }
      @keyframes finglow { 50% { filter: drop-shadow(0 0 7px rgba(var(--m), .9)); } }
      .shine { fill: rgba(255,255,255,.18); }
      ha-card[data-mode="off"] .shine { fill: rgba(255,255,255,.06); }
      .wave { fill: none; stroke: rgba(var(--m), .85); stroke-width: 2.2; stroke-linecap: round; opacity: 0; transform-box: fill-box; }
      ha-card.active[data-fx="heat"] .wave { animation: waveup 2.6s ease-in-out infinite; }
      ha-card.active[data-fx="eco"] .wave { animation: waveup 5s ease-in-out infinite; stroke-width: 1.6; }
      ha-card.active[data-fx="frost"] .wave { stroke: rgba(190,230,255,.8); stroke-dasharray: 2 4; animation: waveup 6s ease-in-out infinite; }
      .w1 { animation-delay: -.7s !important; } .w2 { animation-delay: -1.4s !important; } .w3 { animation-delay: -2s !important; }
      @keyframes waveup { 0% { opacity: 0; transform: translateY(6px); } 35% { opacity: .95; } 100% { opacity: 0; transform: translateY(-10px); } }
      .mlabel { display: inline-flex; align-items: center; gap: 5px; font-size: 15px; font-weight: 700; color: rgb(var(--m)); transition: color .5s; }
      .mlabel ha-icon { --mdc-icon-size: 17px; }
      ha-card[data-mode="off"] .mlabel { color: var(--tx2); }

      /* stats */
      .side { display: flex; flex-direction: column; gap: 8px; }
      .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 4px; }
      .stat { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 5px 2px; border-radius: 10px; background: rgba(255,255,255,.05); }
      .stat ha-icon { --mdc-icon-size: 14px; color: var(--tx2); }
      .stat b { font-size: 12.5px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .stat small { font-size: 9.5px; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .stat.hot ha-icon, .stat.hot b { color: rgb(var(--m)); }

      /* modes */
      .modes { display: flex; gap: 4px; padding: 3px; border-radius: 14px; background: rgba(0,0,0,.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
      ha-card:not(.compact) .modes { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px; }
      .mode { position: relative; flex: 1 1 0; min-width: 0; height: 36px; border-radius: 11px; display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--tx2); transition: background .3s, color .3s, box-shadow .3s; }
      ha-card:not(.compact) .mode { flex-direction: column; gap: 1px; height: 46px; }
      .mode ha-icon { --mdc-icon-size: 19px; flex: 0 0 auto; }
      .mode.sub ha-icon { --mdc-icon-size: 16px; opacity: .85; }
      .mode span { display: none; font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      ha-card:not(.compact) .mode span { display: block; font-size: 10.5px; font-weight: 700; max-width: 100%; }
      .mode em { position: absolute; top: -5px; right: -3px; font-style: normal; font-size: 9.5px; font-weight: 800; padding: 1px 4px; border-radius: 6px; background: #fff; color: rgb(var(--c)); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
      .mode.on { color: #fff; background: linear-gradient(180deg, rgba(var(--c), .95), rgba(var(--c), .7)); box-shadow: 0 3px 12px -2px rgba(var(--c), .6); }
      .mode:not(.on):hover { background: rgba(255,255,255,.06); color: rgb(var(--c)); }

      .na { display: none; position: absolute; inset: 0; place-items: center; background: rgba(8,12,18,.8); color: var(--tx2); font-size: 13px; }
      ha-card.unavail .na { display: grid; }

      /* compact : une ligne */
      ha-card.compact .row { position: relative; display: flex; align-items: center; gap: 9px; padding: 8px 8px 8px 10px; }
      ha-card.compact .glow { background: linear-gradient(90deg, rgba(var(--m), .28), transparent 60%) !important; }
      ha-card.compact[data-mode="off"] .glow { background: none !important; }
      .modes.sm { flex: 0 0 auto; padding: 2px; border-radius: 12px; gap: 2px; }
      .modes.sm .mode { flex: 0 0 30px; width: 30px; height: 32px; border-radius: 10px; }
      .modes.sm .mode ha-icon { --mdc-icon-size: 18px; }
      .modes.sm .mode em { font-size: 8.5px; top: -4px; right: -4px; }

      @container (max-width: 200px) {
        .wrap { padding: 10px 9px; }
        .badge { flex-basis: 30px; width: 30px; height: 30px; border-radius: 10px; }
        .badge ha-icon { --mdc-icon-size: 18px; }
        .name { font-size: 13px; } .status { font-size: 11px; }
        .stats[data-n="3"] .stat small { display: none; }
        .stat b { font-size: 11.5px; }
        .modes .mode ha-icon { --mdc-icon-size: 18px; }
      }
      @container (max-width: 419px) {
        ha-card.compact .row { flex-wrap: wrap; row-gap: 8px; padding: 9px 10px 10px; }
        ha-card.compact .ttl { flex: 1 1 0; }
        .modes.sm { flex: 1 1 100%; }
        .modes.sm .mode { flex: 1 1 0; width: auto; }
      }
      @container (max-width: 329px) {
        ha-card:not(.compact) .modes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @container (min-width: 420px) {
        .main { flex-direction: row; align-items: center; gap: 16px; }
        .hero { flex: 0 0 170px; }
        .rad { max-width: 170px; }
        .side { flex: 1; min-width: 0; gap: 10px; }
        ha-card:not(.compact) .mode { height: 50px; }
        .stat { padding: 7px 4px; } .stat b { font-size: 14px; }
      }`;
    }
  }

  class HolmRadiatorCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      if (this._form && !this._self) this._form.data = this._data();
    }
    set hass(hass) {
      this._hass = hass;
      this._render();
    }
    connectedCallback() {
      this._render();
    }
    _data() {
      return { layout: "card", show_power: true, show_energy: true, show_temperature: true, ...this._config };
    }
    _render() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        const f = document.createElement("ha-form");
        f.schema = [
          { name: "entity", required: true, selector: { entity: { domain: ["select", "input_select", "climate"] } } },
          { type: "grid", name: "", schema: [
            { name: "name", selector: { text: {} } },
            { name: "layout", selector: { select: { mode: "dropdown", options: [{ value: "card", label: "Carte" }, { value: "compact", label: "Compacte (1 ligne)" }] } } },
          ] },
          { type: "grid", name: "", schema: [
            { name: "show_power", selector: { boolean: {} } },
            { name: "show_energy", selector: { boolean: {} } },
            { name: "show_temperature", selector: { boolean: {} } },
          ] },
          { type: "expandable", name: "", title: "Capteurs (détectés automatiquement si vide)", schema: [
            { name: "power_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
            { name: "energy_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
            { name: "temperature_entity", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
            { name: "icon", selector: { icon: {} } },
          ] },
        ];
        const L = {
          entity: "Radiateur (select fil pilote ou climate)", name: "Nom affiché", layout: "Mise en page",
          show_power: "Puissance", show_energy: "Énergie du jour", show_temperature: "Température pièce",
          power_entity: "Capteur de puissance", energy_entity: "Capteur d'énergie", temperature_entity: "Capteur de température", icon: "Icône",
        };
        f.computeLabel = (s) => L[s.name] || s.name;
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          this._config = ev.detail.value;
          this._self = true;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
          setTimeout(() => (this._self = false), 0);
        });
        this._form = f;
        this.appendChild(f);
      }
      this._form.hass = this._hass;
      this._form.data = this._data();
    }
  }

  if (!customElements.get("holm-radiator-card")) customElements.define("holm-radiator-card", HolmRadiatorCard);
  if (!customElements.get("holm-radiator-card-editor")) customElements.define("holm-radiator-card-editor", HolmRadiatorCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "holm-radiator-card")) {
    window.customCards.push({
      type: "holm-radiator-card",
      name: "HOLM Radiateur",
      description: "Radiateur électrique fil pilote : ambiance animée selon le mode (Confort, Éco, Hors-gel, Arrêt), puissance et énergie du jour.",
      preview: true,
    });
  }
})();

console.info("%c HOLM-RADIATOR %c 1.0.0 ", "background:#ff7a28;color:#111;border-radius:3px 0 0 3px", "background:#123;color:#fff;border-radius:0 3px 3px 0");
