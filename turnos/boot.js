/* Портал змін: вхід кодом із пошти, завантаження даних після входу і міст до коду сторінки (window.claude → Supabase).
   У публічному коді немає імен, ставок і графіка: усе приходить із бази й лише після входу. */
(function () {
  const SB_URL = 'https://pevqiebvyjvshneoftru.supabase.co';
  const SB_KEY = 'sb_publishable_uu564O5fAEHdS1_rCw7tzw_QLuwRFOv';
  const POLL_MS = 20000;
  const L = {
    es: {
      title: 'Turnos Limón Loco', lede: 'Entra con tu email de trabajo. Te enviaremos un código de 6 dígitos.',
      email: 'Tu email', send: 'Enviarme el código', code: 'Código de 6 dígitos', enter: 'Entrar', back: 'Usar otro email',
      sent: 'Te hemos enviado un código a {e}. Si no lo ves, mira en spam.', wait: 'Cargando…', resend: 'Enviar otro código',
      noaccess: 'Este email no tiene acceso. Pide al gestor de tu parque que te añada.', bad: 'Código incorrecto o caducado.',
      fail: 'No se ha podido enviar. Inténtalo de nuevo en un minuto.', many: 'Demasiados intentos. Espera un minuto.', out: 'Salir', loadfail: 'No se han podido cargar los datos. Recarga la página.'
    },
    uk: {
      title: 'Turnos Limón Loco', lede: 'Увійдіть через робочу пошту. Ми надішлемо 6-значний код.',
      email: 'Ваша пошта', send: 'Надіслати код', code: '6-значний код', enter: 'Увійти', back: 'Інша пошта',
      sent: 'Код надіслано на {e}. Якщо не бачите, перевірте спам.', wait: 'Завантаження…', resend: 'Надіслати ще раз',
      noaccess: 'Ця пошта не має доступу. Попросіть менеджера парку додати вас.', bad: 'Код неправильний або застарів.',
      fail: 'Не вдалося надіслати. Спробуйте ще раз за хвилину.', many: 'Забагато спроб. Зачекайте хвилину.', out: 'Вийти', loadfail: 'Не вдалося завантажити дані. Оновіть сторінку.'
    }
  };
  let lang = 'es';
  try { lang = localStorage.getItem('ll3_lang') || ((navigator.language || '').startsWith('uk') ? 'uk' : 'es'); } catch (e) { }
  if (!L[lang]) lang = 'es';
  const tx = (k, v) => (L[lang][k] || k).replace('{e}', v || '');
  const $ = id => document.getElementById(id);
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  /* ---------- екран входу ---------- */
  function paintLogin() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-l10n]').forEach(el => { el.textContent = tx(el.dataset.l10n); });
    $('lg-email').placeholder = 'nombre@gmail.com';
    document.querySelectorAll('#lg-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === lang)));
  }
  function msg(t, bad) { const m = $('lg-msg'); m.textContent = t || ''; m.hidden = !t; m.classList.toggle('off', !!bad); }
  function showLogin(step) {
    $('login').hidden = false; $('portal').hidden = true;
    $('lg-s1').hidden = step === 2; $('lg-s2').hidden = step !== 2; paintLogin();
    (step === 2 ? $('lg-code') : $('lg-email')).focus();
  }
  let email = '';
  async function sendCode() {
    email = $('lg-email').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { $('lg-email').focus(); return; }
    const b = $('lg-send'); b.disabled = true; msg('');
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
    b.disabled = false;
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (error.status === 403 || m.includes('acces') || m.includes('доступ') || m.includes('not allowed')) msg(tx('noaccess'), true);
      else if (error.status === 429) msg(tx('many'), true);
      else msg(tx('fail'), true);
      return;
    }
    showLogin(2); msg(tx('sent', email));
  }
  async function verify() {
    const token = $('lg-code').value.replace(/\D/g, '');
    if (token.length < 6) { $('lg-code').focus(); return; }
    const b = $('lg-go'); b.disabled = true;
    const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    b.disabled = false;
    if (error || !data.session) { msg(error && error.status === 429 ? tx('many') : tx('bad'), true); return; }
    msg(''); start();
  }
  function wireLogin() {
    $('lg-f1').onsubmit = e => { e.preventDefault(); sendCode(); };
    $('lg-f2').onsubmit = e => { e.preventDefault(); verify(); };
    $('lg-back').onclick = () => { msg(''); showLogin(1); };
    $('lg-again').onclick = () => { $('lg-email').value = email; sendCode(); };
    document.querySelectorAll('#lg-lang button').forEach(b => { b.onclick = () => { lang = b.dataset.l; try { localStorage.setItem('ll3_lang', lang); } catch (e) { } paintLogin(); }; });
  }

  /* ---------- дані після входу ---------- */
  async function all(table, cols, order) {
    const out = []; const step = 1000;
    for (let i = 0; ; i += step) {
      let q = sb.from(table).select(cols || '*').range(i, i + step - 1);
      (order || []).forEach(o => { q = q.order(o); });
      const { data, error } = await q; if (error) throw error;
      out.push(...data); if (data.length < step) return out;
    }
  }
  async function loadPlan(me) {
    const [ppl, days, slots, meta] = await Promise.all([
      all('turnos_people', '*', ['ord']), all('turnos_days', '*', ['park', 'd']), all('turnos_slots', '*', ['park', 'd', 'ord']),
      me.role === 'employee' ? Promise.resolve([]) : all('turnos_meta')]);
    const PLAN = {}; const idx = {};
    for (const d of days) {
      const o = { d: d.d, t: d.t, fest: d.fest, open: d.open_t, close: d.close_t, walk: d.walk, parties: d.parties, booked: d.booked, slots: [] };
      (PLAN[d.park] = PLAN[d.park] || { days: [], open: {} }).days.push(o); idx[d.park + d.d] = o;
    }
    for (const z of slots) { const o = idx[z.park + z.d]; if (o) o.slots.push({ role: z.role, pos: z.pos, start: z.start_t, end: z.end_t, h: Number(z.h), pri: z.pri }); }
    const PEOPLE = ppl.map(p => ({ id: p.id, park: p.park, name: { es: p.name_es, uk: p.name_uk }, note: { es: p.note_es, uk: p.note_uk }, roles: p.roles, limit: p.limit_h === null ? null : Number(p.limit_h), per: p.per, ref: p.ref === null ? null : Number(p.ref), decl: p.decl, baja: p.baja }));
    const order = ['LL3', 'LL1', 'LL2', 'LL4', 'LL5'].filter(k => PLAN[k]);
    const m = meta.find(x => x.key === 'park_method');
    return { PLAN, PEOPLE, PARK_ORDER: order, METHOD: m ? m.data : { es: {}, uk: {} } };
  }

  /* ---------- міст до коду сторінки ---------- */
  let mailT = null;
  function kick() { clearTimeout(mailT); mailT = setTimeout(() => { sb.functions.invoke('turnos-notify', { body: {} }).catch(() => { }); }, 2500); }
  function pgErr(error) { const e = new Error(error.message || 'db'); e.code = (error.code === '42501' || error.status === 403) ? 'invalid_argument' : 'failed'; return e; }
  const MAP = {
    claims: { table: 'turnos_claims', key: 'slot_id', from: r => ({ person: r.person, park: r.park, auto: r.auto, at: r.at, by: r.by_user, slot: r.slot_id, src: r.src }), to: (id, o) => ({ slot_id: id, person: o.person, park: o.park || '', auto: !!o.auto, src: o.src || null }) },
    rules: { table: 'turnos_rules', key: 'person', from: r => r.data, to: (id, o) => ({ person: id, park: (window.__T.PEOPLE.find(p => p.id === id) || {}).park, data: o }) },
    declared: { table: 'turnos_declared', key: 'id', from: r => ({ person: r.person, park: r.park, week: r.week, hours: Number(r.hours), at: r.at }), to: (id, o) => ({ id, person: o.person, park: o.park, week: o.week, hours: o.hours }) },
    rates: { table: 'turnos_rates', key: 'person', from: r => r.data, to: (id, o) => ({ person: id, data: o }) }
  };
  const subs = {};
  async function refresh(name) {
    const s = subs[name]; if (!s) return;
    try {
      const rows = await all(MAP[name].table);
      const sig = JSON.stringify(rows);
      if (sig === s.sig) return; s.sig = sig;
      const docs = rows.map(r => ({ id: r[MAP[name].key], data: () => MAP[name].from(r) }));
      s.cbs.forEach(cb => cb({ docs }));
    } catch (e) { s.errs.forEach(f => f(e)); }
  }
  function docRef(name, id) {
    const m = MAP[name];
    return {
      async get() {
        if (!m) return { exists: false, data: () => null };
        const { data, error } = await sb.from(m.table).select('*').eq(m.key, id).maybeSingle();
        if (error) throw pgErr(error);
        return { exists: !!data, data: () => (data ? m.from(data) : null) };
      },
      async set(o) {
        if (!m) return; const { error } = await sb.from(m.table).upsert(m.to(id, o));
        if (error) throw pgErr(error); await refresh(name); if (name === 'claims') kick();
      },
      async delete() {
        if (!m) return; const { error } = await sb.from(m.table).delete().eq(m.key, id);
        if (error) throw pgErr(error); await refresh(name); if (name === 'claims') kick();
      },
      async acquire() { return { acquired: true }; }
    };
  }
  function makeDb(me, uid) {
    return {
      collection(name) {
        return {
          doc: id => docRef(name, id),
          onSnapshot(cb, err) {
            if (!MAP[name]) { setTimeout(() => cb({ docs: [] }), 0); return () => { }; }
            const s = subs[name] = subs[name] || { cbs: [], errs: [], sig: null };
            s.cbs.push(cb); if (err) s.errs.push(err); s.sig = null; refresh(name);
            return () => { };
          }
        };
      },
      doc(path) {
        if (path === 'roles/' + uid) {
          const x = { exists: true, data: () => ({ role: me.role, park: me.park, person: me.person }) };
          return { onSnapshot(cb) { setTimeout(() => cb(x), 0); return () => { }; }, get: async () => x };
        }
        const none = { exists: false, data: () => null };
        return { onSnapshot(cb) { setTimeout(() => cb(none), 0); return () => { }; }, get: async () => none, set: async () => { }, delete: async () => { } };
      }
    };
  }
  function saveFile({ filename, data }) {
    const url = URL.createObjectURL(new Blob([data], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  let started = false;
  async function start() {
    if (started) return; started = true;
    $('login').hidden = true; $('portal').hidden = true; $('lg-wait').hidden = false; $('lg-wait').textContent = tx('wait');
    try {
      const { data: u } = await sb.auth.getUser();
      const { data: me, error } = await sb.rpc('turnos_me');
      if (error) throw error;
      if (!me) { started = false; await sb.auth.signOut(); $('lg-wait').hidden = true; showLogin(1); msg(tx('noaccess'), true); return; }
      const data = await loadPlan(me);
      window.__T = Object.assign(data, { sb, me, kick, signOut: () => sb.auth.signOut().then(() => { try { localStorage.removeItem('ll_me'); } catch (e) { } location.reload(); }) });
      try { if (!localStorage.getItem('ll3_lang')) localStorage.setItem('ll3_lang', me.lang || lang); } catch (e) { }
      const db = makeDb(me, u.user.id);
      window.claude = {
        use: async what => {
          if (what === 'db') return db;
          if (what === 'user') return { id: async () => u.user.id, isOwner: async () => me.role === 'admin' };
          if (what === 'downloads') return { save: async o => saveFile(o) };
          return null;
        }
      };
      setInterval(() => { if (!document.hidden) Object.keys(subs).forEach(refresh); }, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) Object.keys(subs).forEach(refresh); });
      const s = document.createElement('script'); s.src = 'app.js?v=202611011514';
      s.onload = () => { $('lg-wait').hidden = true; $('portal').hidden = false; };
      document.body.append(s);
    } catch (e) {
      started = false; console.error(e); $('lg-wait').hidden = true; showLogin(1); msg(tx('loadfail'), true);
    }
  }
  wireLogin();
  sb.auth.getSession().then(({ data }) => { if (data.session) start(); else showLogin(1); });
})();
