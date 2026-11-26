// Token Radar dashboard, radar-5. Reads window.RADAR and renders
// the ranked board, a filterable table, a live-token view, and a
// per-protocol detail drawer with the model's derivation, its
// nearest traded comparables, its benchmarks and its costed
// eight-step farm plan. No network: every byte it shows is in
// data.js. The page refits the model in this browser from the peer
// table -- the same least squares, in the same order, as
// lib/model.ts -- recomputes all 198 implied values, and prints an
// integrity strip with a seal that must equal the seal main.ts
// computed. The farm steps are the ones main.ts wrote for each row.
(function () {
  'use strict';
  const DATA = window.RADAR;
  if (!DATA) return;
  const app = document.getElementById('board');
  const state = { q: '', category: 'all', chain: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, deposit: 5000, share: 0.07, tbill: 0.04 };

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n < 0) return '-$' + (Math.abs(n) >= 100 ? String(Math.round(Math.abs(n))) : Math.abs(n).toFixed(2));
    return n >= 100 ? '$' + String(Math.round(n)) : '$' + n.toFixed(2);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function ageDays(listedAt) {
    if (!listedAt) return null;
    const a = Date.parse(DATA.as_of + 'T00:00:00Z');
    const b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / 86400000));
  }

  // FNV-1a, 32-bit, as eight hex digits: the seal, computed here over
  // the recomputed values and compared with the seal main.ts wrote.
  function fnv1aHex(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // The model's own arithmetic, repeated here so the page refits it
  // from the peer table: the same least squares through the normal
  // equations, the same Gaussian elimination with partial pivoting,
  // in the same order as lib/model.ts, so the refit lands on the
  // same numbers. A peer is [category, TVL, market cap, 7d change,
  // listed date, chain count]; a board row reads the same way.
  function solveLinear(a, b) {
    const n = b.length;
    const m = a.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      const tmp = m[c]; m[c] = m[piv]; m[piv] = tmp;
      const d = m[c][c];
      for (let j = c; j <= n; j++) m[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = m[r][c];
        if (f === 0) continue;
        for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
      }
    }
    return m.map((row) => row[n]);
  }

  function leastSquares(features, y) {
    const k = features[0].length;
    const a = [];
    const b = [];
    for (let r = 0; r < k; r++) { a.push(new Array(k).fill(0)); b.push(0); }
    for (let i = 0; i < features.length; i++) {
      const x = features[i];
      for (let r = 0; r < k; r++) {
        b[r] += x[r] * y[i];
        for (let c = 0; c < k; c++) a[r][c] += x[r] * x[c];
      }
    }
    return solveLinear(a, b);
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // Feature order is the contract with lib/model.ts: intercept, log
  // TVL, then the quadratic, the growth term, log age and chain
  // count, in that order.
  function featuresOf(cat, tvl, change7d, listedAt, nChains) {
    const logTvl = Math.log(tvl);
    const spec = DATA.fit.spec;
    const x = [1, logTvl];
    if (spec.quad) x.push((logTvl * logTvl) / 10);
    if (spec.growth || spec.growthCap) x.push(clamp(change7d === null || change7d === undefined ? 0 : change7d, -60, 120) / 100);
    if (spec.logAge) x.push(Math.log((ageDays(listedAt) === null ? 365 : ageDays(listedAt)) + 30));
    if (spec.chains) x.push(Math.log(nChains + 1));
    return x;
  }

  function growthIndex() {
    const spec = DATA.fit.spec;
    if (!spec.growth && !spec.growthCap) return -1;
    return 2 + (spec.quad ? 1 : 0);
  }

  function fitFromPeers() {
    const spec = DATA.fit.spec;
    const peers = DATA.peers;
    const x = peers.map((p) => featuresOf(p[0], p[1], p[3], p[4], p[5]));
    const y = peers.map((p) => Math.log(p[2]));
    const beta = leastSquares(x, y);
    const meanLogTvl = peers.reduce((s, p) => s + Math.log(p[1]), 0) / peers.length;
    const offsets = {};
    const slopes = {};
    const gi = growthIndex();
    if (spec.catShrink !== null || spec.catSlope !== null) {
      const byCat = {};
      peers.forEach((p, i) => {
        const cat = p[0] || 'Other';
        const e = byCat[cat] || (byCat[cat] = { res: [], centred: [] });
        e.res.push(y[i] - dot(beta, x[i]));
        e.centred.push(Math.log(p[1]) - meanLogTvl);
      });
      Object.keys(byCat).forEach((cat) => {
        const e = byCat[cat];
        if (spec.catShrink !== null) {
          const m = e.res.reduce((s, v) => s + v, 0) / e.res.length;
          offsets[cat] = (m * e.res.length) / (e.res.length + spec.catShrink);
        }
        if (spec.catSlope !== null) {
          let num = 0, den = 0;
          for (let i = 0; i < e.res.length; i++) { num += e.centred[i] * e.res[i]; den += e.centred[i] * e.centred[i]; }
          const slope = den === 0 ? 0 : num / den;
          slopes[cat] = (slope * e.res.length) / (e.res.length + spec.catSlope);
        }
      });
    }
    return {
      beta: beta, meanLogTvl: meanLogTvl, offsets: offsets, slopes: slopes,
      predict: function (cat, tvl, change7d, listedAt, nChains) {
        const logTvl = Math.log(tvl);
        const feats = featuresOf(cat, tvl, change7d, listedAt, nChains);
        feats[1] = logTvl;
        if (spec.quad) feats[2] = (logTvl * logTvl) / 10;
        let v = dot(beta, feats);
        if (spec.growthCap && gi >= 0) {
          const contrib = beta[gi] * feats[gi];
          v += clamp(contrib, -DATA.model.growth_cap, DATA.model.growth_cap) - contrib;
        }
        const c = cat || 'Other';
        if (spec.catShrink !== null) v += offsets[c] || 0;
        if (spec.catSlope !== null) v += (slopes[c] || 0) * (logTvl - meanLogTvl);
        return v;
      }
    };
  }

  // Refit once, at load, and keep the result for the integrity strip:
  // every row recomputed, the seal over the recomputed values, the
  // rank order, the totals, the watchlist and the ledger.
  const REFIT = (function () {
    try {
      const f = fitFromPeers();
      const recomputed = DATA.rows.map((r) => Math.max(1, Math.round(Math.exp(f.predict(r.category, r.tvl_usd, r.change_7d, r.listed_at, (r.chains || []).length)))));
      let matched = 0;
      let totalBoard = 0;
      let totalRefit = 0;
      for (let i = 0; i < DATA.rows.length; i++) {
        if (recomputed[i] === DATA.rows[i].implied_value_usd) matched++;
        totalBoard += DATA.rows[i].implied_value_usd;
        totalRefit += recomputed[i];
      }
      let ordered = true;
      for (let i = 1; i < recomputed.length; i++) if (recomputed[i] > recomputed[i - 1]) ordered = false;
      const slugs = {};
      DATA.rows.forEach((r) => { slugs[r.slug] = true; });
      let watch = 0;
      (DATA.watchlist || []).forEach((s) => { if (slugs[s]) watch++; });
      return {
        ok: true,
        matched: matched,
        total: DATA.rows.length,
        seal: fnv1aHex(recomputed.join(',')),
        sealMatches: fnv1aHex(recomputed.join(',')) === DATA.seal,
        ordered: ordered,
        totalBoard: totalBoard,
        totalRefit: totalRefit,
        watch: watch,
        watchTotal: (DATA.watchlist || []).length,
        bySlug: Object.fromEntries(DATA.rows.map((r, i) => [r.slug, recomputed[i]])),
        intercept: f.beta[0],
        slope: f.beta[1]
      };
    } catch (e) {
      return { ok: false, matched: 0, total: DATA.rows.length, seal: '????????', sealMatches: false, ordered: false, totalBoard: 0, totalRefit: 0, watch: 0, watchTotal: 0, bySlug: {}, intercept: NaN, slope: NaN };
    }
  })();

  // The farm economics of any scenario, from a row's own figures:
  // the slice scales with the deposit and the share, the gas does
  // not move. The same rule as lib/model.ts: FARM needs net at
  // least $25 and $10 an hour, THIN needs net above -$10.
  function farmHours() {
    const m = DATA.model;
    return (m.setup_minutes + m.verify_minutes + m.fund_minutes + m.risk_minutes + m.core_minutes + m.deepen_minutes + m.cadence_minutes + m.exit_minutes) / 60;
  }

  function econOf(row, deposit, share) {
    const slice = (row.implied_value_usd * share * deposit) / row.tvl_usd;
    const net = slice - row.gas_usd;
    const perHour = net / farmHours();
    const verdict = net >= DATA.model.farm_net_usd && perHour >= DATA.model.farm_net_per_hour_usd ? 'FARM' : net > DATA.model.thin_net_usd ? 'THIN' : 'SKIP';
    return { slice: slice, net: net, perHour: perHour, verdict: verdict, tbill: (deposit * state.tbill * DATA.model.horizon_weeks) / 52 };
  }

  function farmCounts(deposit, share) {
    const c = { farm: 0, thin: 0, skip: 0 };
    DATA.rows.forEach((r) => {
      const v = econOf(r, deposit, share).verdict;
      if (v === 'FARM') c.farm++;
      else if (v === 'THIN') c.thin++;
      else c.skip++;
    });
    return c;
  }

  // A tiny element builder: attrs are class, text, html, on* handlers
  // or plain attributes; children are strings, nodes or arrays of them.
  function el(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach((c) => { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The hash is the shareable state: #p=<slug> opens a protocol,
  // #category=<category> filters the board, and the search, chain,
  // verdict and selection ride along in the same way.
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('v')) state.verdict = params.get('v');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('v', state.verdict);
    if (state.selected) params.set('p', state.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && econOf(r, state.deposit, state.share).verdict !== state.verdict) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  // One sort key at a time; a repeated click on the same header flips
  // the direction, a click on another header starts from strongest
  // first. Equal values fall back to the slug, so the order is stable.
  function sortedRows(list) {
    const key = state.sort;
    return list.slice().sort((a, b) => {
      let av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'net') { av = econOf(a, state.deposit, state.share).net; bv = econOf(b, state.deposit, state.share).net; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // Two short lines, no essay above the board.
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'Every clean pre-token protocol, watchlist first: ' + DATA.board_size + ' rows from ' + DATA.ledger.total + ' protocols. Implied value is a fitted model, not a promise.' })
      )
    );
  }

  // The KPI strip: one compact row of five small cards, each a number
  // the held-out tests computed, not a claim. The farm counts follow
  // the what-if scenario the reader picked.
  function kpis() {
    const h = DATA.held_out;
    const o = DATA.odds;
    const f = farmCounts(state.deposit, state.share);
    return el('section', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { text: 'Typical miss, held out' }), el('b', { text: h.loo_median_factor.toFixed(2) + 'x leave-one-out' }), el('span', { class: 'sub', text: h.wf_median_factor.toFixed(2) + 'x walk-forward' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Printed ranges hold' }), el('b', { text: Math.round(h.coverage_p25_p75 * 100) + '% in P25–P75' }), el('span', { class: 'sub', text: Math.round(h.coverage_p10_p90 * 100) + '% in P10–P90, out of sample' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Token odds, Brier' }), el('b', { text: o.brier_cell.toFixed(3) + ' cell model' }), el('span', { class: 'sub', text: o.brier_buckets.toFixed(3) + ' buckets · ' + o.brier_constant.toFixed(3) + ' constant' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Worth farming' }), el('b', { text: f.farm + ' FARM of ' + DATA.board_size }), el('span', { class: 'sub', text: f.thin + ' thin, ' + f.skip + ' skip at $' + state.deposit.toLocaleString('en-US') + ' and ' + Math.round(state.share * 1000) / 10 + '%' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Fitted curve' }), el('b', { text: DATA.fit.intercept.toFixed(2) + ' + ' + DATA.fit.slope.toFixed(2) + ' log TVL' }), el('span', { class: 'sub', text: DATA.fit.peers + ' clean live peers' }))
    );
  }

  // The accounting ledger as one thin bar: every protocol counted
  // once, in exactly one segment.
  function ledgerBar() {
    const l = DATA.ledger;
    const early = l.early - l.watchlist;
    const aside = l.excluded_category + l.excluded_name;
    const seg = (color, label, n) => el('span', { class: 'seg' }, el('span', { class: 'dot', style: 'background:' + color }), el('b', { text: String(n) }), el('span', { text: label }));
    return el('div', { class: 'ledger-bar' },
      el('b', { text: l.total + ' protocols:' }),
      seg('#2dd4a7', 'watchlist', l.watchlist),
      seg('#f5b94a', 'early', early),
      seg('#9aa8c0', 'live token', l.live_token),
      seg('#5b6b8c', 'set aside', aside)
    );
  }

  // The integrity strip: the refit this browser just ran, in one
  // line. If any part of it fails, the strip says so in the open
  // instead of hiding it.
  function integrityStrip() {
    const r = REFIT;
    const ok = r.ok && r.matched === r.total && r.sealMatches && r.ordered && r.totalBoard === r.totalRefit && r.watch === r.watchTotal;
    const text = ok
      ? 'Refitted in this browser: ' + r.matched + ' of ' + r.total + ' rows recomputed · ranks 1–' + r.total + ' in order, values never rise · total ' + fmtUsd(r.totalBoard) + ' · seal ' + r.seal + ' = ' + DATA.seal + ' · watchlist ' + r.watch + ' of ' + r.watchTotal + ' · ledger ' + DATA.ledger.total + ' of ' + DATA.ledger.total
      : 'Refit check FAILED: ' + r.matched + ' of ' + r.total + ' rows recomputed · seal ' + r.seal + ' against ' + DATA.seal + ' · watchlist ' + r.watch + ' of ' + r.watchTotal + ' · totals ' + fmtUsd(r.totalRefit) + ' against ' + fmtUsd(r.totalBoard);
    return el('div', { class: 'seal' + (ok ? '' : ' seal-bad') }, el('b', { text: ok ? 'Integrity: refit agrees' : 'Integrity: refit disagrees' }), el('span', { text: text }));
  }

  // The evidence table: every model variant put through the same two
  // held-out tests, one line per row so the board keeps its rows. A
  // term is kept only if it lowers the miss in BOTH tests; the size
  // curve on clean peers is the only one that does, so it is the
  // model and the rest are shown as dropped, with the numbers that
  // killed them. The family term could not be tested at all, and its
  // row says so. The growth-beta numbers live in the model panel
  // below the board.
  function evidencePanel() {
    const h = DATA.held_out;
    const rows = h.variants.map((v) => el('tr', null,
      el('td', null, el('b', { text: v.name })),
      el('td', { class: 'num', text: v.note ? '—' : String(v.peers) }),
      el('td', { class: 'num', text: v.note ? '—' : (v.loo_text || v.loo_median_factor.toFixed(2) + 'x') }),
      el('td', { class: 'num', text: v.note ? '—' : (v.wf_text || v.wf_median_factor.toFixed(2) + 'x') }),
      el('td', null, v.note ? el('span', { class: 'sub', text: v.note }) : el('span', { class: 'status' + (v.kept ? '' : ' live'), text: v.kept ? 'kept' : 'dropped' }))
    ));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Out-of-sample evidence — each term tested alone' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Variant' }), el('th', { scope: 'col', text: 'Peers' }), el('th', { scope: 'col', text: 'Leave-one-out' }), el('th', { scope: 'col', text: 'Walk-forward' }), el('th', { scope: 'col', text: 'Kept' }))),
          el('tbody', null, rows)
        )
      )
    );
  }

  // The log-log scatter, small enough to sit beside the evidence
  // table: live clean peers against the board, with the fitted line.
  function scatterPanel() {
    const fit = DATA.fit;
    const pts = DATA.peers.map((p) => ({ x: Math.log(p[1]), y: Math.log(p[2]), board: false }));
    DATA.rows.forEach((r) => { pts.push({ x: Math.log(r.tvl_usd), y: Math.log(r.implied_value_usd), board: true }); });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    x0 -= 0.4; x1 += 0.4; y0 -= 0.4; y1 += 0.4;
    const W = 560, H = 150, PL = 56, PR = 12, PT = 10, PB = 28;
    const X = (v) => PL + ((v - x0) / (x1 - x0)) * (W - PL - PR);
    const Y = (v) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of market cap against TVL">';
    [5e6, 5e7, 5e8, 5e9].forEach((t) => {
      const v = Math.log(t);
      if (v < x0 || v > x1) return;
      s += '<line x1="' + X(v).toFixed(1) + '" y1="' + PT + '" x2="' + X(v).toFixed(1) + '" y2="' + (H - PB) + '" class="grid"/><text x="' + X(v).toFixed(1) + '" y="' + (H - PB + 16) + '" class="axis">' + fmtUsd(t) + '</text>';
    });
    [1e5, 1e6, 1e7, 1e8, 1e9].forEach((t) => {
      const v = Math.log(t);
      if (v < y0 || v > y1) return;
      s += '<line x1="' + PL + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/><text x="' + (PL - 8) + '" y="' + (Y(v).toFixed(1) + 4) + '" class="axis" text-anchor="end">' + fmtUsd(t) + '</text>';
    });
    s += '<line x1="' + X(x0).toFixed(1) + '" y1="' + Y(fit.intercept + fit.slope * x0).toFixed(1) + '" x2="' + X(x1).toFixed(1) + '" y2="' + Y(fit.intercept + fit.slope * x1).toFixed(1) + '" class="fitline"/>';
    pts.forEach((p) => {
      s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (p.board ? 2 : 2.6) + '" class="' + (p.board ? 'dot-board' : 'dot-live') + '"/>';
    });
    s += '</svg>';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The size curve, seen' }),
      el('p', { class: 'sub', text: 'Market cap against TVL, log scales. Teal: ' + DATA.fit.peers + ' clean live peers; amber: ' + DATA.board_size + ' board rows.' }),
      el('div', { class: 'scatter', html: s })
    );
  }

  function controls() {
    const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
    const chains = Array.from(new Set(DATA.rows.flatMap((r) => r.chains || []))).sort();
    const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
    // One select builder for the filters and the what-if controls:
    // the what-if selects recompute every row's slice, net, net per
    // hour and verdict live, and the KPI strip with it. The default
    // is the middle of each range: $5,000, 7%, 4%.
    const sel = (id, label, opts, cur, fmt, onpick) => {
      const s = el('select', { id: id, 'aria-label': label },
        opts.map((o) => el('option', { value: String(o), text: fmt(o), selected: o === cur ? 'selected' : null }))
      );
      s.addEventListener('change', () => { onpick(s.value); render(); });
      return el('div', { class: 'field' + (id === 'deposit' || id === 'share' || id === 'tbill' ? ' whatif' : ''), id: null }, el('label', { for: id, text: label }), s);
    };
    const pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { state.tab = 'pre-token'; render(); } });
    const live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      sel('category', 'Category', ['all'].concat(categories), state.category, (c) => c === 'all' ? 'All categories' : c, (v) => { state.category = v; writeHash(); }),
      sel('chain', 'Chain', ['all'].concat(chains), state.chain, (c) => c === 'all' ? 'All chains' : c, (v) => { state.chain = v; writeHash(); }),
      sel('verdict', 'Verdict', ['all', 'FARM', 'THIN', 'SKIP'], state.verdict, (v) => v === 'all' ? 'Any verdict' : v, (v) => { state.verdict = v; writeHash(); }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      sel('deposit', 'What if: deposit', [1000, 5000, 10000], state.deposit, (d) => '$' + d.toLocaleString('en-US'), (v) => { state.deposit = Number(v); }),
      sel('share', 'Drop share', [0.035, 0.07, 0.14], state.share, (s) => (s * 100).toFixed(1) + '%', (v) => { state.share = Number(v); }),
      sel('tbill', 'T-bill', [0, 0.04, 0.08], state.tbill, (t) => (t * 100).toFixed(0) + '%', (v) => { state.tbill = Number(v); }),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  // A sortable header: the arrow shows the direction, and aria-sort
  // says it to a screen reader too.
  function sortHeader(key, label) {
    const active = state.sort === key;
    const sort = active ? (state.dir < 0 ? 'descending' : 'ascending') : 'none';
    return el('th', { scope: 'col', 'aria-sort': sort },
      el('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        active ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(v) {
    return el('span', { class: 'verdict verdict-' + v.toLowerCase(), text: v });
  }

  function boardTable() {
    const list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or verdict to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    const max = list.reduce((m, r) => Math.max(m, r.implied_value_usd), 1);
    const tbody = el('tbody');
    list.forEach((r) => {
      const e = econOf(r, state.deposit, state.share);
      const netClass = e.net >= 0 ? 'pos' : 'neg';
      const tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => { openDetail(r.slug); },
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('div', { class: 'rankcell' }, el('b', { text: String(r.rank) }), el('span', { class: 'sub', text: r.rank_low === r.rank_high ? '· exact' : '· ' + r.rank_low + '–' + r.rank_high }))),
        el('td', null, el('div', { class: 'name name-row' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains[0] : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: r.token_odds.toFixed(2) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true', title: 'Implied value ' + fmtUsd(r.implied_value_usd) }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) })
        )),
        el('td', null, verdictBadge(e.verdict)),
        el('td', { class: 'num ' + netClass, text: (e.net >= 0 ? '+' : '-') + fmtMoney(Math.abs(e.net)) + ' / ' + fmtMoney(e.perHour) + '/h' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Net is the costed farm return at $' + state.deposit.toLocaleString('en-US') + ' and ' + Math.round(state.share * 1000) / 10 + '%.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('odds', 'Token odds'),
            sortHeader('implied', 'Implied value'),
            sortHeader('net', 'Verdict'),
            sortHeader('net', 'Net / hour')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    const tbody = el('tbody');
    DATA.live.forEach((r) => {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. The 24 biggest of ' + DATA.live_total + ' live-token protocols are shown; they are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The accounting ledger: every protocol in the snapshot, in exactly
  // one group, with the counts summing to the snapshot's total. The
  // watchlist is a subset of the board, not a separate group, so the
  // board is the first two rows together.
  function ledgerPanel() {
    const l = DATA.ledger;
    const row = (label, n, why) => el('tr', null,
      el('td', null, el('b', { text: label })),
      el('td', { class: 'num', text: String(n) }),
      el('td', { class: 'sub', text: why })
    );
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Where all ' + l.total + ' protocols went' }),
      el('p', { class: 'sub', text: 'Every protocol in the snapshot sits in exactly one group. The board is the first two rows; the rest are set aside, with the house rule\u2019s reason.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Group' }), el('th', { scope: 'col', text: 'Count' }), el('th', { scope: 'col', text: 'Why it is here' }))),
          el('tbody', null,
            row('Ranked, on the watchlist', l.watchlist, 'At least $50M TVL and no token on record: the floor.'),
            row('Ranked, early beyond the watchlist', l.early - l.watchlist, 'Clean pre-token protocols below the floor.'),
            row('Live token, set aside', l.live_token, 'Already trades, so the market cap is a fact; the 24 biggest are shown above.'),
            row('Set aside by category', l.excluded_category, 'Bridge, liquid staking, restaked BTC or exchange: a wrapped or staked product of a token that trades.'),
            row('Set aside by name', l.excluded_name, 'A versioned pool, a wrapped or staked product by name, or an exchange\u2019s own product.'),
            row('Total', l.total, 'The snapshot\u2019s protocol count, and the five groups above add to it.')
          )
        )
      )
    );
  }

  // Token odds: the cell model, its Brier scores against the three
  // baselines on both held-out tests, the dropped logistic, and the
  // walk-forward bucket coverage that shows the test's own weakness.
  function oddsPanel() {
    const o = DATA.odds;
    const cellRows = o.cells.map((c) => el('tr', null,
      el('td', null, el('b', { text: c.label })),
      el('td', { class: 'num', text: String(c.n) }),
      el('td', { class: 'num', text: String(c.tokens) }),
      el('td', { class: 'num', text: c.rate.toFixed(2) })
    ));
    const brierRow = (label, loo, wf) => el('tr', null,
      el('td', null, el('b', { text: label })),
      el('td', { class: 'num', text: loo.toFixed(3) }),
      el('td', { class: 'num', text: wf.toFixed(3) })
    );
    const wfRows = o.wf_buckets.map((b) => el('tr', null,
      el('td', null, el('b', { text: b.bucket })),
      el('td', { class: 'num', text: String(b.train_n) }),
      el('td', { class: 'num', text: String(b.test_n) }),
      el('td', { class: 'num', text: b.train_rate.toFixed(2) })
    ));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Token odds: age bucket x category group' }),
      el('p', { class: 'sub', text: 'Odds are the share of peer protocols in the cell that record a token, shrunk toward the bucket rate (shrink ' + DATA.model.odds_shrink + '). The five biggest categories get their own group; everything else is pooled, so no cell is a single protocol.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Cell' }), el('th', { scope: 'col', text: 'Protocols' }), el('th', { scope: 'col', text: 'With a token' }), el('th', { scope: 'col', text: 'Odds' }))),
          el('tbody', null, cellRows)
        )
      ),
      el('h3', { text: 'Brier score, lower is better' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Model' }), el('th', { scope: 'col', text: 'Leave-one-out' }), el('th', { scope: 'col', text: 'Walk-forward' }))),
          el('tbody', null,
            brierRow('Cell model (kept)', o.brier_cell, o.wf_brier_cell),
            brierRow('Age buckets alone', o.brier_buckets, o.wf_brier_buckets),
            brierRow('Constant ' + o.base_rate.toFixed(2) + ' guess', o.brier_constant, o.wf_brier_constant),
            brierRow('Fitted logistic (dropped)', o.brier_logistic, o.wf_brier_logistic)
          )
        )
      ),
      el('p', { class: 'sub', text: 'The cell model beats the buckets, the constant and the logistic on both tests. The fitted logistic (log TVL, log age, growth, chain count, category groups, ridge ' + DATA.model.logistic_lambda + ') scores ' + o.brier_logistic.toFixed(3) + ' out of sample, worse than the age buckets alone.' }),
      el('h3', { text: 'Why the walk-forward odds test is weak, in its own numbers' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Age bucket' }), el('th', { scope: 'col', text: 'Training protocols' }), el('th', { scope: 'col', text: 'Test protocols' }), el('th', { scope: 'col', text: 'Training rate' }))),
          el('tbody', null, wfRows)
        )
      ),
      el('p', { class: 'sub', text: 'Walk-forward splits by listing date, and age at the snapshot IS the listing date, so the two halves hold different ages: the training half holds no protocol under 3 years old and the test half none over 3, except 9 in the 2-3 year bucket. The young buckets have no training data and fall back to the training base rate, so the walk-forward scores are all high (the label rate shifts from ' + o.wf_train_base.toFixed(2) + ' to ' + o.wf_test_base.toFixed(2) + '), and leave-one-out is the test that ranks the odds models. The walk-forward constant is the training rate, not the overall rate, which would peek at the test period.' })
    );
  }

  // The model, in the page's own words, with the formula printed from
  // the same fitted numbers the model ran on, and the caveats in the
  // open: what the board does not do.
  function modelPanel() {
    const m = DATA.model;
    const f = DATA.fit;
    const h = DATA.held_out;
    const hours = farmHours().toFixed(2);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One fitted curve scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( exp( ' + f.intercept.toFixed(4) + ' + ' + f.slope.toFixed(4) + ' x log(TVL) ) )'
      ),
      el('p', { class: 'sub', text: 'The intercept and slope are fitted by least squares on log market cap against log TVL over the ' + f.peers + ' live-token protocols that pass the board\u2019s own cleanliness rule (' + f.peer_rule + '). The range around each value is the held-out P25–P75, ' + h.loo_p25_factor.toFixed(2) + 'x to ' + h.loo_p75_factor.toFixed(2) + 'x: ' + Math.round(h.coverage_p25_p75 * 100) + '% of held-out values fall inside it and ' + Math.round(h.coverage_p10_p90 * 100) + '% inside P10–P90. Young protocols miss ' + h.young_median_factor.toFixed(2) + 'x, older ones ' + h.old_median_factor.toFixed(2) + 'x — less predictable, not more, so the range is not narrowed for them. The growth term fails hardest: its coefficient is ' + h.growth_beta_pre2024.toFixed(2) + ' fitted on protocols listed before 2024 and ' + h.growth_beta_full.toFixed(2) + ' on the full set -- it flips sign, so it is noise the walk-forward test exposes. A family term could not be tested: the snapshot carries no parent field. A token launch is not predicted here: implied value is what a token would be worth if the protocol\u2019s record stayed as it is.' }),
      el('p', { class: 'sub', text: 'Farm economics, on a $' + m.ticket_usd.toLocaleString('en-US') + ' ticket over ' + m.horizon_weeks + ' weeks at a ' + Math.round(m.airdrop_share * 100) + '% drop share: the expected slice is implied value x ' + Math.round(m.airdrop_share * 100) + '% x ticket / TVL; gas is the plan\u2019s actual ' + m.tx_count + ' transactions — fund the wallet 1, deposit 1, core action 1, deepen 1, four cadence actions, claim and exit 2 — priced by first chain: Ethereum $' + m.gas_ethereum_usd.toFixed(2) + ', Base, Arbitrum and Optimism $' + m.gas_l2_usd.toFixed(2) + ', Solana $' + m.gas_solana_usd.toFixed(2) + ', anything else $' + m.gas_default_usd.toFixed(2) + '; time is ' + hours + ' hours. FARM needs net at least $' + m.farm_net_usd + ' and $' + m.farm_net_per_hour_usd + ' an hour; THIN needs net above -$' + Math.abs(m.thin_net_usd) + '; the rest is SKIP. The $' + m.ticket_usd.toLocaleString('en-US') + ' ticket and ' + Math.round(m.airdrop_share * 100) + '% share are the middle of the what-if ranges: a $1,000 ticket is too thin for the big pools, since its slice does not cover Ethereum gas, and $10,000 is a serious farmer\u2019s ticket.' }),
      el('h3', { text: 'What this board does not do' }),
      el('p', { class: 'sub', text: 'It never says a token will launch, or when: the odds are the share of past peers that record one, and the implied value is the launch value, not a prediction. The printed range is a P25–P75 range, so about half of held-out values fall outside it. The rank range is exact under the size curve alone, because rank is TVL order there; the uncertainty lives in the values, and a category term that would move ranks did not survive testing. The farm economics assume the stated drop share, which no protocol has promised. Snapshot ' + DATA.as_of + ', floor $' + Math.round(DATA.floor_usd / 1e6) + 'M.' })
    );
  }

  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  function openDetail(slug) {
    const row = DATA.rows.filter((r) => r.slug === slug)[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    const e = econOf(row, state.deposit, state.share);
    const recomputed = REFIT.ok ? REFIT.bySlug[row.slug] : NaN;
    const cell = DATA.odds.cells.filter((c) => c.label === row.odds_bucket)[0];
    const oddsCheck = cell ? (Math.abs(cell.rate - row.token_odds) < 1e-12 ? 'matches board.json' : 'differs from the board: the data would be stale') : 'cell not found';
    const gridCells = [1000, 5000, 10000].map((d) => [0.035, 0.07, 0.14].map((s) => econOf(row, d, s)));
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · range ' + row.rank_low + '–' + row.rank_high }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => { dialog.close(); } })
    ));
    const left = el('div', { class: 'detail-col' },
      el('section', { class: 'detail-section' },
        el('h3', { text: 'How the figure is made' }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'deriv' },
            el('tbody', null,
              el('tr', null, el('td', { text: 'TVL' }), el('td', { class: 'num', text: fmtUsd(row.tvl_usd) })),
              el('tr', null, el('td', { text: 'Seven-day growth' }), el('td', { class: 'num', text: fmtPct(row.change_7d) + (row.growth_carry === 0 ? ' · fitted and dropped, carries 0' : ' · carries ' + (row.growth_carry > 0 ? '+' : '') + row.growth_carry.toFixed(3) + ' in log space') })),
              el('tr', null, el('td', { text: 'Size curve' }), el('td', { class: 'num', text: 'log mcap = ' + DATA.fit.intercept.toFixed(2) + ' + ' + DATA.fit.slope.toFixed(2) + ' log TVL' })),
              el('tr', null, el('td', { text: 'Category premium' }), el('td', { class: 'num', text: row.cat_premium === 1 ? '1.00x · fitted and dropped' : row.cat_premium.toFixed(2) + 'x' })),
              el('tr', null, el('td', { text: 'Value if it launches' }), el('td', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
              el('tr', null, el('td', { text: 'Token odds' }), el('td', { class: 'num', text: row.token_odds.toFixed(2) + ' (' + row.odds_bucket + ')' })),
              el('tr', null, el('td', { text: 'Implied value, ranked on' }), el('td', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
              el('tr', null, el('td', { text: 'P25–P75 range' }), el('td', { class: 'num', text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) })),
              el('tr', null, el('td', { text: 'P10–P90 range' }), el('td', { class: 'num', text: fmtUsd(row.implied_value_usd * DATA.held_out.loo_p10_factor) + ' – ' + fmtUsd(row.implied_value_usd * DATA.held_out.loo_p90_factor) })),
              el('tr', null, el('td', { text: 'Bootstrap rank range' }), el('td', { class: 'num', text: 'rank ' + row.rank + ' of ' + DATA.board_size + '; ' + row.rank_low + ' to ' + row.rank_high + ' across 200 refits' }))
            )
          )
        ),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': ' + DATA.held_out.chosen_name + ', fitted on ' + DATA.fit.peers + ' clean live peers. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' The odds cell rate ' + oddsCheck + '. The board does not discount by odds: implied value is the launch value, and the odds sit beside it so the reader discounts it themselves.' })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Nearest traded comparables' }),
        el('p', { class: 'sub', text: 'Same category first, then log-TVL distance, among the ' + DATA.fit.peers + ' clean live peers. The prediction is the model\u2019s held-out prediction for that peer: a fit that never saw it.' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Token' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Cap / TVL' }), el('th', { scope: 'col', text: 'Model would say' }))),
            el('tbody', null, row.comparables.map((c) => el('tr', null,
              el('td', null, el('b', { text: c.symbol + ' · ' + c.slug })),
              el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
              el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }),
              el('td', { class: 'num', text: c.ratio.toFixed(3) }),
              el('td', { class: 'num', text: fmtUsd(c.pred_usd) })
            )))
          )
        )
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Benchmarks' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'Same ticket in a T-bill, ' + Math.round(state.tbill * 100) + '%' }), el('b', { class: 'num', text: fmtMoney(e.tbill) + ' over 12 weeks' })),
          el('div', null, el('span', { text: 'Drop share that covers the gas' }), el('b', { class: 'num', text: (row.share_breakeven * 100).toFixed(1) + '%' })),
          el('div', null, el('span', { text: 'Token odds that cover the gas' }), el('b', { class: 'num', text: row.odds_breakeven > 1 ? '>1.00 — no odds cover the gas at this ticket' : row.odds_breakeven.toFixed(2) })),
          el('div', null, el('span', { text: 'If TVL doubles to ' + fmtUsd(row.tvl_double_usd) }), el('b', { class: 'num', text: 'implied ' + fmtUsd(row.implied_double_usd) + ', slice ' + fmtMoney(row.slice_double_usd) + ', net ' + fmtMoney(row.net_double_usd) })),
          el('div', null, el('span', { text: 'If TVL falls 30% to ' + fmtUsd(row.tvl_down30_usd) }), el('b', { class: 'num', text: 'implied ' + fmtUsd(row.implied_down30_usd) + ' — leave: the launch case is momentum, and this board prices size, not momentum' }))
        ),
        el('p', { class: 'sub', text: 'If the TVL doubles, the slice falls, because the same ticket is a smaller share of a bigger pool. If it falls 30%, the slice would rise but the implied value falls with it, and a falling TVL is the launch case breaking.' })
      )
    );
    const right = el('div', { class: 'detail-col' },
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm economics at $' + state.deposit.toLocaleString('en-US') + ' and ' + Math.round(state.share * 1000) / 10 + '%' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'Ticket' }), el('b', { class: 'num', text: fmtMoney(state.deposit) })),
          el('div', null, el('span', { text: 'Expected slice' }), el('b', { class: 'num', text: fmtMoney(e.slice) })),
          el('div', null, el('span', { text: 'Gas, ' + DATA.model.tx_count + ' transactions' }), el('b', { class: 'num', text: fmtMoney(row.gas_usd) })),
          el('div', null, el('span', { text: 'Net' }), el('b', { class: 'num', text: fmtMoney(e.net) })),
          el('div', null, el('span', { text: 'Net per hour' }), el('b', { class: 'num', text: fmtMoney(e.perHour) })),
          el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: e.verdict }))
        ),
        el('p', { class: 'sub', text: 'Slice is implied value x ' + Math.round(state.share * 1000) / 10 + '% x ticket / TVL over 12 weeks; gas is ' + DATA.model.tx_count + ' transactions at the chain\u2019s price (Ethereum $2.00, Base/Arbitrum/Optimism $0.10, Solana $0.05, other $0.25). FARM needs net at least $25 and $10 an hour; THIN needs net above -$10; the rest is SKIP.' })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Net by deposit and drop share' }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'grid3' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Deposit \\ share' }), el('th', { scope: 'col', text: '3.5%' }), el('th', { scope: 'col', text: '7%' }), el('th', { scope: 'col', text: '14%' }))),
            el('tbody', null, [1000, 5000, 10000].map((d, di) => el('tr', null,
              el('td', null, el('b', { text: '$' + d.toLocaleString('en-US') })),
              [0.035, 0.07, 0.14].map((s, si) => {
                const g = gridCells[di][si];
                const cur = d === state.deposit && s === state.share;
                return el('td', { class: 'num' + (g.net >= 0 ? ' pos' : ' neg') + (cur ? ' cur' : ''), text: fmtMoney(g.net) });
              })
            )))
          )
        ),
        el('p', { class: 'sub', text: 'The highlighted cell is the scenario picked above the board.' })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan' }),
        el('ol', { class: 'steps' }, row.steps.map((s) => el('li', null,
          el('b', { text: s.phase + ' — ' + s.text }),
          el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '. ' + (s.txs === 0 ? 'No transaction.' : s.txs + (s.txs === 1 ? ' transaction.' : ' transactions.')) })
        )))
      )
    );
    dialog.appendChild(el('div', { class: 'detail-grid' }, left, right));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // A full re-render on every state change: the table is 198 rows,
  // small enough to rebuild rather than patch, and rebuilding keeps
  // the filters, the sort and the drawer from ever drifting apart.
  function render() {
    app.textContent = '';
    const shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpis());
    shell.appendChild(ledgerBar());
    shell.appendChild(integrityStrip());
    shell.appendChild(el('div', { class: 'duo' }, evidencePanel(), scatterPanel()));
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(ledgerPanel());
      shell.appendChild(oddsPanel());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
