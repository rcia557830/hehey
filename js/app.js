(() => {
  'use strict';

  // ========================================================================
  // CONSTANTS — local workspace preferences are not an authentication boundary.
  // ========================================================================
  const VERSION = 2;
  const STORAGE_KEY = 'veritas_core_workspace_v2';
  const SESSION_KEY = 'veritas_core_session';
  const DB_NAME = 'veritas_core_files';
  const DB_STORE = 'files';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
  const COLLECTIONS = ['clients', 'documents', 'transactions', 'compliance', 'invoices', 'knowledge'];
  const CLIENT_TYPES = ['Sole Proprietorship', 'Corporation', 'Partnership', 'Cooperative'];
  const DOC_TYPES = ['Certificate of Registration', 'Client Business License', 'Receipt', 'Invoice', 'Statement', 'Financial Statement', 'Tax Filing Confirmation', 'Other'];
  const DOC_STATUSES = ['Submitted', 'Under Review', 'Reviewed', 'Needs Clarification', 'Accepted'];
  const AGENCIES = ['BIR', 'SEC', 'CDA', 'LGU', 'BOA', 'DOLE', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Other'];
  const CATEGORIES = ['Procedure', 'Compliance', 'Ledger Review', 'Client Service', 'Reference'];
  const ROLES = {
    Owner: { manage: true, import: true, reset: true, billing: true },
    'Office Manager': { manage: true, import: true, reset: false, billing: true },
    Bookkeeper: { manage: false, import: false, reset: false, billing: false }
  };
  const PAGES = {
    overview: { title: 'Overview', icon: 'grid-1x2', description: 'Your practice at a glance' },
    clients: { title: 'Clients', icon: 'people', collection: 'clients', singular: 'client' },
    documents: { title: 'Documents', icon: 'folder2-open', collection: 'documents', singular: 'document' },
    ledger: { title: 'Ledger Review', icon: 'journal-text', collection: 'transactions', singular: 'entry' },
    compliance: { title: 'Compliance', icon: 'calendar2-check', collection: 'compliance', singular: 'deadline' },
    billing: { title: 'Billing', icon: 'receipt', collection: 'invoices', singular: 'invoice' },
    knowledge: { title: 'Knowledge', icon: 'book', collection: 'knowledge', singular: 'article' },
    workspace: { title: 'Workspace', icon: 'sliders2', description: 'Preferences and workspace data' }
  };
  const ENTITY = {
    clients: { label: 'client', prefix: 'CL', icon: 'people', view: 'clients' },
    documents: { label: 'document', prefix: 'DOC', icon: 'folder2-open', view: 'documents' },
    transactions: { label: 'entry', prefix: 'TXN', icon: 'journal-text', view: 'ledger' },
    compliance: { label: 'deadline', prefix: 'CMP', icon: 'calendar2-check', view: 'compliance' },
    invoices: { label: 'invoice', prefix: 'INV', icon: 'receipt', view: 'billing' },
    knowledge: { label: 'article', prefix: 'KB', icon: 'book', view: 'knowledge' }
  };

  // ========================================================================
  // UTILITIES — formatting, safe HTML, local calendar dates, and validation.
  // ========================================================================
  const $ = id => document.getElementById(id);
  const escapeHTML = (value = '') => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const money = value => new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', maximumFractionDigits: 2
  }).format(value || 0);
  const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
  const sum = (rows, key) => rows.reduce((total, row) => total + Math.round(Number(row[key]) * 100), 0) / 100;
  const percent = (part, total) => total ? Math.round(part / total * 100) : 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const icon = name => `<i class="bi bi-${escapeHTML(name)}" aria-hidden="true"></i>`;
  const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

  function localISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function shiftDate(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return localISO(date);
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && localISO(date) === value;
  }

  function dateFmt(value) {
    return isDate(value) ? new Intl.DateTimeFormat('en-PH', {
      day: 'numeric', month: 'short', year: 'numeric'
    }).format(new Date(`${value}T12:00:00`)) : 'Not set';
  }

  function timeFmt(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not saved yet' : date.toLocaleString('en-PH', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function daysUntil(value) {
    if (!isDate(value)) return Infinity;
    const parts = value.split('-').map(Number);
    const now = new Date();
    return Math.round((Date.UTC(parts[0], parts[1] - 1, parts[2]) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  }

  function debounce(callback, delay = 180) {
    let timer;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...args), delay);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  }

  function matches(query, ...parts) {
    return parts.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }

  function invoiceStatus(invoice) {
    return invoice.status === 'Paid' ? 'Paid' : daysUntil(invoice.dueDate) < 0 ? 'Overdue' : 'Open';
  }

  function docNeedsAttention(doc) {
    return !['Reviewed', 'Accepted'].includes(doc.status) &&
      (doc.status === 'Needs Clarification' || (doc.dueDate && daysUntil(doc.dueDate) <= 3));
  }

  function deadlineStatus(record) {
    const days = daysUntil(record.dueDate);
    if (record.status === 'Filed') return { text: 'Filed', tone: 'success', className: 'filed' };
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'danger', className: 'urgent' };
    if (days === 0) return { text: 'Due today', tone: 'warning', className: 'soon' };
    return { text: `${days}d remaining`, tone: days <= 10 ? 'warning' : 'info', className: days <= 10 ? 'soon' : '' };
  }

  // ========================================================================
  // SEED — fictional firm records, with relative internal preparation dates.
  // These are operational examples, not a statutory filing calendar.
  // ========================================================================
  function seedData() {
    const names = [
      ['Davao Prime Trading', 'Sole Proprietorship', 'Mara Santos'],
      ['Lanang Café Group', 'Corporation', 'Paolo Reyes'],
      ['Calinan Growers Cooperative', 'Cooperative', 'Elena Cruz'],
      ['Southline Professional Services', 'Partnership', 'Rafael Lim'],
      ['Matina Builders', 'Corporation', 'Liza Ramos'],
      ['Northpoint Logistics', 'Corporation', 'Carlo Tan'],
      ['Toril Hardware', 'Sole Proprietorship', 'Ana Mendoza'],
      ['Bajada Food Hub', 'Sole Proprietorship', 'Miguel Garcia']
    ];
    const clients = names.map(([name, type, contact], index) => ({
      id: `CL-${String(index + 1).padStart(3, '0')}`, name, type, contact,
      email: `accounts${index + 1}@example.com`, phone: '', tin: '',
      cbl: index === 2 ? 'Pending' : 'On file', cor: index === 5 ? 'Pending' : 'On file',
      status: 'Active', notes: '', createdAt: shiftDate(-60 + index)
    }));
    const documents = [
      { id: 'DOC-001', clientId: 'CL-001', title: 'Business registration records', type: 'Certificate of Registration', status: 'Accepted', receivedDate: shiftDate(-12), dueDate: '' },
      { id: 'DOC-002', clientId: 'CL-003', title: 'Supplier receipts — September', type: 'Receipt', status: 'Needs Clarification', receivedDate: shiftDate(-4), dueDate: shiftDate(2), notes: 'Request clearer copies of receipts 014 and 018.' },
      { id: 'DOC-003', clientId: 'CL-002', title: 'Financial statements for review', type: 'Financial Statement', status: 'Under Review', receivedDate: shiftDate(-2), dueDate: shiftDate(5) },
      { id: 'DOC-004', clientId: 'CL-006', title: 'Bank statement reconciliation pack', type: 'Statement', status: 'Submitted', receivedDate: shiftDate(-1), dueDate: shiftDate(1) },
      { id: 'DOC-005', clientId: 'CL-005', title: 'Permit renewal documentation', type: 'Client Business License', status: 'Reviewed', receivedDate: shiftDate(-7), dueDate: '' }
    ].map(doc => ({ notes: '', fileKey: '', fileName: '', ...doc }));
    const compliance = [
      ['CMP-001', 'CL-001', 'BIR', 'Quarterly tax filing review', 3],
      ['CMP-002', 'CL-002', 'SEC', 'Annual report preparation', 8],
      ['CMP-003', 'CL-003', 'CDA', 'Cooperative report review', -2],
      ['CMP-004', 'CL-004', 'BIR', 'Withholding reconciliation', 14],
      ['CMP-005', 'CL-005', 'LGU', 'Business permit documentation', 21],
      ['CMP-006', 'CL-006', 'SSS', 'Contribution schedule review', 1]
    ].map(([id, clientId, agency, requirement, offset]) => ({
      id, clientId, agency, requirement, dueDate: shiftDate(offset), status: 'Pending',
      filedDate: '', notes: 'Internal target date. Confirm the applicable filing deadline before submission.'
    }));
    const transactions = [
      ['TXN-001', 'CL-001', 'OR-101', 'Office supplies purchase', 'Office Supplies Expense', 2500, 0, 'Reviewed'],
      ['TXN-002', 'CL-001', 'OR-101', 'Office supplies payment', 'Cash', 0, 2500, 'Reviewed'],
      ['TXN-003', 'CL-002', 'SI-221', 'Catering receivable', 'Accounts Receivable', 8000, 0, 'For Review'],
      ['TXN-004', 'CL-002', 'SI-221', 'Catering revenue', 'Service Revenue', 0, 8000, 'For Review']
    ].map(([id, clientId, reference, description, account, debit, credit, status]) => ({
      id, clientId, reference, description, account, debit, credit, status, date: shiftDate(-5)
    }));
    return {
      meta: { version: VERSION, firm: 'RBCIA Accounting Firm', lastSaved: new Date().toISOString() },
      clients, documents, transactions, compliance,
      invoices: [
        { id: 'INV-001', clientId: 'CL-001', date: shiftDate(-15), dueDate: shiftDate(5), amount: 6500, status: 'Open', description: 'Monthly accounting services' },
        { id: 'INV-002', clientId: 'CL-002', date: shiftDate(-20), dueDate: shiftDate(-5), amount: 7500, status: 'Open', description: 'Tax preparation and reconciliation' },
        { id: 'INV-003', clientId: 'CL-003', date: shiftDate(-10), dueDate: shiftDate(10), amount: 5000, status: 'Paid', description: 'Monthly record review' }
      ],
      knowledge: [
        { id: 'KB-001', title: 'A consistent start for every client', category: 'Client Service', tags: ['onboarding', 'registration'], content: 'Confirm the engagement scope and primary contact.\n\nCollect the Certificate of Registration and current business permit, record the client’s reporting obligations, and assign an internal review schedule.\n\nCheck that the engagement letter has been approved before work begins.' },
        { id: 'KB-002', title: 'Start preparation 10 days ahead', category: 'Compliance', tags: ['preparation', 'filing'], content: 'Request supporting information at least 10 days before the confirmed filing deadline.\n\nAssign an internal reviewer and resolve missing information early. Verify the applicable deadline with the responsible agency.\n\nAfter submission, retain the filing acknowledgment with the client’s documents.' },
        { id: 'KB-003', title: 'From intake to accepted document', category: 'Procedure', tags: ['documents', 'quality'], content: 'Log each document against its client on receipt. Move it to Under Review when the review begins.\n\nUse Needs Clarification for unreadable or incomplete submissions, and record exactly what is needed.\n\nMark the document Reviewed when checked, then Accepted when it is ready for the client file.' },
        { id: 'KB-004', title: 'Before entries go to the general ledger', category: 'Ledger Review', tags: ['reconciliation', 'review'], content: 'Check client, date, reference, and account classification against the source document.\n\nReconcile debit and credit totals for the relevant client and period. A balanced total alone does not establish that all entries are correct.\n\nRecord the review status here. Post approved entries in the firm’s general ledger system.' }
      ],
      activity: [{ id: uid('ACT'), text: 'Workspace opened with initial records.', at: new Date().toISOString() }]
    };
  }

  // ========================================================================
  // STATE — one owner for data, navigation, preferences, and transient UI.
  // ========================================================================
  const state = {
    data: null, view: 'overview', role: 'Office Manager', user: 'RBCIA team', query: '',
    kbCategory: 'All', sort: {}, filters: { clientType: 'All', archive: 'Active', status: 'All', client: 'All' },
    cmdk: { open: false, query: '', index: 0, results: [], returnFocus: null },
    fileDB: null, fileReady: null, sessionToken: '', readNotifications: new Set(),
    storageWarnings: new Set(), unsaved: false, busy: false, form: null,
    formModal: null, detailModal: null, confirmResolve: null, detailRecord: null,
    returnFocus: null, sidebarOpen: false,
    storageSnapshot: null, recoveryMode: false
  };

  // ========================================================================
  // STORAGE — schemas are reconstructed, not blindly trusted or merged.
  // ========================================================================
  function textField(record, key, required = false, max = 2000) {
    const value = record[key] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new Error(`Invalid ${key} in workspace data.`);
    }
    return value.trim();
  }

  function enumField(record, key, choices) {
    if (!choices.includes(record[key])) throw new Error(`Invalid ${key} in workspace data.`);
    return record[key];
  }

  function dateField(record, key, optional = false) {
    const value = record[key] || '';
    if (optional && value === '') return '';
    if (!isDate(value)) throw new Error(`Invalid ${key} date in workspace data.`);
    return value;
  }

  function amountField(record, key, positive = false) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > 1e12 || (positive && value === 0) || Math.abs(value * 100 - Math.round(value * 100)) > .01) {
      throw new Error(`Invalid ${key} amount in workspace data.`);
    }
    return Math.round(value * 100) / 100;
  }

  function validateRecord(collection, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid record.');
    const id = textField(input, 'id', true, 100);
    const clientId = collection === 'clients' || collection === 'knowledge' ? '' : textField(input, 'clientId', true, 100);
    switch (collection) {
      case 'clients':
        return {
          id, name: textField(input, 'name', true, 180), type: enumField(input, 'type', CLIENT_TYPES),
          contact: textField(input, 'contact', false, 180), email: textField(input, 'email', false, 254),
          phone: textField(input, 'phone', false, 60), tin: textField(input, 'tin', false, 80),
          cbl: enumField(input, 'cbl', ['Pending', 'On file']), cor: enumField(input, 'cor', ['Pending', 'On file']),
          status: enumField(input, 'status', ['Active', 'Archived']), notes: textField(input, 'notes'),
          createdAt: dateField(input, 'createdAt')
        };
      case 'documents':
        return {
          id, clientId, title: textField(input, 'title', true, 250), type: enumField(input, 'type', DOC_TYPES),
          status: enumField(input, 'status', DOC_STATUSES), receivedDate: dateField(input, 'receivedDate'),
          dueDate: dateField(input, 'dueDate', true), fileKey: textField(input, 'fileKey', false, 150),
          fileName: textField(input, 'fileName', false, 255), notes: textField(input, 'notes')
        };
      case 'transactions': {
        const debit = amountField(input, 'debit');
        const credit = amountField(input, 'credit');
        if ((debit > 0) === (credit > 0)) throw new Error('Use a positive debit or credit, not both.');
        return {
          id, clientId, date: dateField(input, 'date'), reference: textField(input, 'reference', false, 100),
          description: textField(input, 'description', true, 250), account: textField(input, 'account', true, 180),
          debit, credit, status: enumField(input, 'status', ['For Review', 'Reviewed'])
        };
      }
      case 'compliance':
        return {
          id, clientId, agency: enumField(input, 'agency', AGENCIES),
          requirement: textField(input, 'requirement', true, 250), dueDate: dateField(input, 'dueDate'),
          status: enumField(input, 'status', ['Pending', 'Filed']), filedDate: dateField(input, 'filedDate', true),
          notes: textField(input, 'notes')
        };
      case 'invoices': {
        const date = dateField(input, 'date');
        const dueDate = dateField(input, 'dueDate');
        if (dueDate < date) throw new Error('The due date cannot be before the invoice date.');
        return {
          id, clientId, date, dueDate, amount: amountField(input, 'amount', true),
          status: enumField(input, 'status', ['Open', 'Paid']), description: textField(input, 'description', true, 250)
        };
      }
      case 'knowledge':
        if (!Array.isArray(input.tags) || input.tags.length > 20 ||
          input.tags.some(tag => typeof tag !== 'string' || tag.length > 60)) throw new Error('Use up to 20 tags, each at most 60 characters.');
        return {
          id, title: textField(input, 'title', true, 250), category: enumField(input, 'category', CATEGORIES),
          tags: [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))], content: textField(input, 'content', true, 30000)
        };
      default: throw new Error('Unknown workspace collection.');
    }
  }

  function validateData(input) {
    if (!input || input.meta?.version !== VERSION) throw new Error('This backup has an unsupported workspace version.');
    const clean = { meta: { version: VERSION, firm: 'RBCIA Accounting Firm', lastSaved: input.meta.lastSaved } };
    if (!Number.isFinite(Date.parse(clean.meta.lastSaved))) throw new Error('Invalid workspace save date.');
    for (const collection of COLLECTIONS) {
      if (!Array.isArray(input[collection]) || input[collection].length > 10000) throw new Error(`Invalid ${collection} list.`);
      clean[collection] = input[collection].map(record => validateRecord(collection, record));
      const ids = clean[collection].map(record => record.id);
      if (new Set(ids).size !== ids.length) throw new Error(`Duplicate IDs in ${collection}.`);
    }
    const clients = new Set(clean.clients.map(client => client.id));
    for (const collection of ['documents', 'transactions', 'compliance', 'invoices']) {
      if (clean[collection].some(record => !clients.has(record.clientId))) throw new Error(`A ${collection} record refers to a missing client.`);
    }
    if (!Array.isArray(input.activity)) throw new Error('Invalid activity log.');
    clean.activity = input.activity.slice(0, 60).map(item => {
      if (!item || !Number.isFinite(Date.parse(item.at))) throw new Error('Invalid activity timestamp.');
      return { id: textField(item, 'id', true, 100), text: textField(item, 'text', true, 1000), at: item.at };
    });
    return clean;
  }

  function migrateData(legacy) {
    if (legacy?.meta?.version !== 1) throw new Error('Unrecognized workspace data.');
    const migrated = clone(legacy);
    migrated.meta.version = VERSION;
    migrated.documents.forEach(doc => { if (doc.status === 'Pending') doc.status = 'Submitted'; });
    migrated.invoices.forEach(invoice => { invoice.status = invoice.status === 'Paid' ? 'Paid' : 'Open'; });
    migrated.knowledge.forEach(article => { if (article.category === 'Bookkeeping') article.category = 'Ledger Review'; });
    // Retain the previous activity history, normalizing older setup messages.
    const history = (Array.isArray(migrated.activity) ? migrated.activity : []).slice(0, 59).map(item => {
      let text = item.text;
      if (/dataset initialized/i.test(text)) text = 'Workspace initialized.';
      else if (/data reset/i.test(text)) text = 'Workspace data reset.';
      else if (/import.*json backup/i.test(text)) text = 'Imported workspace JSON backup.';
      return { ...item, text };
    });
    migrated.activity = [{ id: uid('ACT'), text: 'Existing workspace records migrated to Veritas Core.', at: new Date().toISOString() }, ...history];
    return validateData(migrated);
  }

  function loadData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      state.storageSnapshot = stored;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.meta?.version === VERSION) return validateData(parsed);
        addWarning('A different workspace version was found. The saved original is preserved; initial records are loaded in memory.');
        state.unsaved = true;
        state.recoveryMode = true;
        return seedData();
      }
      const previousKey = Object.keys(localStorage).find(key => key.endsWith('_rbcia_v1'));
      if (previousKey) {
        const migrated = migrateData(JSON.parse(localStorage.getItem(previousKey)));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        state.storageSnapshot = JSON.stringify(migrated);
        return migrated;
      }
      const initial = seedData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      state.storageSnapshot = JSON.stringify(initial);
      return initial;
    } catch (error) {
      state.unsaved = true;
      state.recoveryMode = true;
      addWarning('Saved records could not be loaded. Existing storage is unchanged. Initial records are available in memory; export before leaving.');
      return seedData();
    }
  }

  function commit(next, message, replace = false) {
    if (state.recoveryMode && !replace) throw new Error('Saved data needs recovery. Export the visible records, then import a valid backup or reset the workspace in Settings before saving changes.');
    const candidate = clone(next);
    candidate.meta.lastSaved = new Date().toISOString();
    candidate.activity.unshift({ id: uid('ACT'), text: message, at: candidate.meta.lastSaved });
    candidate.activity = candidate.activity.slice(0, 60);
    // Storage must succeed before the in-memory state changes, avoiding false saves.
    try {
      if (!replace && localStorage.getItem(STORAGE_KEY) !== state.storageSnapshot) {
        throw new Error('Workspace data changed in another tab. Reload before making changes.');
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
      state.storageSnapshot = JSON.stringify(candidate);
    } catch (error) {
      if (error.message.includes('another tab')) throw error;
      throw new Error('This browser could not save the change. Free up storage or export your workspace, then try again.');
    }
    state.data = candidate;
    state.unsaved = false;
    state.recoveryMode = false;
    updateSaveStatus();
  }

  function addWarning(message) {
    state.storageWarnings.add(message);
    const alert = $('storageAlert');
    alert.textContent = [...state.storageWarnings].join(' ');
    alert.hidden = false;
  }

  function loadSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (session && Object.hasOwn(ROLES, session.role)) state.role = session.role;
      if (typeof session?.user === 'string' && session.user.trim()) state.user = session.user.slice(0, 80);
      if (Array.isArray(session?.read)) state.readNotifications = new Set(session.read.filter(value => typeof value === 'string'));
      state.sessionToken = typeof session?.token === 'string' ? session.token : uid('SESSION');
      saveSession();
    } catch (error) {
      state.sessionToken = uid('SESSION');
      addWarning('Session preferences will last until this page is closed.');
    }
  }

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        token: state.sessionToken, user: state.user, role: state.role,
        read: [...state.readNotifications].slice(-200)
      }));
    } catch (error) {
      addWarning('Session preferences could not be saved in this browser.');
    }
  }

  function updateSaveStatus() {
    $('saveStatus').textContent = state.unsaved ? 'In memory · export to keep a copy' : `Saved locally · ${timeFmt(state.data.meta.lastSaved)}`;
  }

  // ========================================================================
  // INDEXEDDB — only document files live here; writes await transaction commit.
  // ========================================================================
  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other workspace tabs to unlock file storage.'));
    });
  }

  function fileRequest(db, mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, mode);
      const request = operation(transaction.objectStore(DB_STORE));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error('File storage was interrupted.'));
    });
  }

  async function initIndexedDB() {
    try {
      state.fileDB = await openDatabase(DB_NAME);
      state.fileDB.onversionchange = () => {
        state.fileDB.close();
        state.fileDB = null;
        addWarning('File storage changed in another tab. Reload before attaching files.');
      };
      if (state.data.documents.some(doc => doc.fileKey) && indexedDB.databases) {
        const databases = await indexedDB.databases();
        const prior = databases.find(db => db.name?.endsWith('_files_v1'));
        if (prior) {
          const oldDB = await openDatabase(prior.name);
          try {
            for (const doc of state.data.documents.filter(item => item.fileKey)) {
              const exists = await fileRequest(state.fileDB, 'readonly', store => store.get(doc.fileKey));
              if (!exists) {
                const file = await fileRequest(oldDB, 'readonly', store => store.get(doc.fileKey));
                if (file) await fileRequest(state.fileDB, 'readwrite', store => store.put(file, doc.fileKey));
              }
            }
          } finally { oldDB.close(); }
        }
      }
    } catch (error) {
      addWarning('File storage is unavailable or could not be fully restored. Records still work; keep original attachments available.');
    }
  }

  async function storeFile(key, file) {
    await state.fileReady;
    if (!state.fileDB) throw new Error('File storage is unavailable. Save without an attachment or try another browser.');
    if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file smaller than 20 MB.');
    await fileRequest(state.fileDB, 'readwrite', store => store.put(file, key));
  }

  async function removeFile(key) {
    if (!key || !state.fileDB) return;
    try { await fileRequest(state.fileDB, 'readwrite', store => store.delete(key)); }
    catch (error) { addWarning('An unused attachment could not be removed from browser storage.'); }
  }

  async function downloadFile(id) {
    const doc = getRecord('documents', id);
    if (!doc?.fileKey) throw new Error('No attachment is linked to this document.');
    await state.fileReady;
    if (!state.fileDB) throw new Error('File storage is unavailable.');
    const blob = await fileRequest(state.fileDB, 'readonly', store => store.get(doc.fileKey));
    if (!blob) throw new Error('This attachment is not in this browser. Reattach the original file from the document form.');
    downloadBlob(blob, doc.fileName || 'document');
    logOnly(`Downloaded attachment for ${doc.title}.`);
    toast('Attachment downloaded.');
  }

  // ========================================================================
  // PERMISSIONS — enforce on dispatch and again immediately before mutation.
  // ========================================================================
  const can = permission => Boolean(ROLES[state.role]?.[permission]);

  function restricted(permission) {
    return can(permission) ? '' : ` disabled title="${escapeHTML(`Not available for the ${state.role} role`)}"`;
  }

  function enforce(permission) {
    if (!can(permission)) throw new Error(`This action is not available for the ${state.role} role.`);
  }

  function actionPermission(action, collection) {
    if (action === 'reset') return 'reset';
    if (['import', 'import-file'].includes(action)) return 'import';
    if (['delete', 'archive'].includes(action)) return 'manage';
    if (action === 'mark-paid' || (collection === 'invoices' && ['new', 'edit'].includes(action))) return 'billing';
    return null;
  }

  // ========================================================================
  // TOASTS — messages never use raw user HTML and remain manually dismissible.
  // ========================================================================
  function toast(message, error = false) {
    const item = document.createElement('div');
    item.className = `app-toast${error ? ' is-error' : ''}`;
    item.setAttribute('role', error ? 'alert' : 'status');
    item.innerHTML = `<div><strong>VERITAS CORE</strong><p>${escapeHTML(message)}</p></div>
      <button class="icon-button" data-action="dismiss-toast" aria-label="Dismiss message">${icon('x-lg')}</button>`;
    $('toastStack').append(item);
    while ($('toastStack').children.length > 4) $('toastStack').firstElementChild.remove();
    let timer = setTimeout(() => item.remove(), error ? 12000 : 6500);
    item.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
    item.addEventListener('focusin', () => clearTimeout(timer), { once: true });
  }

  // ========================================================================
  // MODALS — Bootstrap manages focus traps; forms and details share two shells.
  // ========================================================================
  function rememberFocus() {
    if (!$('detailModal').classList.contains('show') && !$('formModal').classList.contains('show')) {
      state.returnFocus = document.activeElement;
    }
  }

  function restoreFocus() {
    const target = state.returnFocus?.isConnected ? state.returnFocus : $('viewRoot');
    target.focus({ preventScroll: true });
  }

  function openDetail(title, body, footer, record = null) {
    rememberFocus();
    state.detailRecord = record;
    $('detailModalTitle').textContent = title;
    $('detailModalBody').innerHTML = body;
    $('detailModalFooter').innerHTML = footer || '<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>';
    state.detailModal.show();
  }

  function askConfirmation(title, description, label = 'Confirm') {
    return new Promise(resolve => {
      state.confirmResolve = resolve;
      openDetail(title, `<p class="mb-0">${escapeHTML(description)}</p>`, `
        <button class="btn btn-outline-secondary" data-action="confirm-cancel">Cancel</button>
        <button class="btn btn-outline-danger" data-action="confirm-accept">${escapeHTML(label)}</button>`);
    });
  }

  function finishConfirmation(accepted) {
    const resolve = state.confirmResolve;
    state.confirmResolve = null;
    $('detailModal').addEventListener('hidden.bs.modal', () => resolve?.(accepted), { once: true });
    state.detailModal.hide();
  }

  function detailToEdit(collection, id) {
    $('detailModal').addEventListener('hidden.bs.modal', () => openRecordForm(collection, id), { once: true });
    state.detailModal.hide();
  }

  function showFormError(message) {
    $('formError').textContent = message;
    $('formError').hidden = false;
    $('formError').scrollIntoView({ block: 'nearest' });
  }

  // ========================================================================
  // HELPERS — reusable accessible view fragments and selectors.
  // ========================================================================
  const getRecord = (collection, id) => state.data[collection]?.find(record => record.id === id);
  const clientName = id => getRecord('clients', id)?.name || 'Unknown client';
  const recordTitle = record => record.name || record.title || record.requirement || record.description || record.id;

  function button(label, action, options = {}) {
    const { collection = '', id = '', view = '', permission = '', tone = 'outline-secondary', small = false, glyph = '' } = options;
    return `<button class="btn btn-${escapeHTML(tone)}${small ? ' btn-sm' : ''}" data-action="${escapeHTML(action)}"
      data-collection="${escapeHTML(collection)}" data-id="${escapeHTML(id)}" data-view="${escapeHTML(view)}"${permission ? restricted(permission) : ''}>
      ${glyph ? icon(glyph) : ''}${escapeHTML(label)}</button>`;
  }

  function iconButton(label, action, collection, id, glyph, permission = '') {
    const unavailable = permission && !can(permission);
    return `<button class="icon-button" data-action="${escapeHTML(action)}" data-collection="${escapeHTML(collection)}"
      data-id="${escapeHTML(id)}" aria-label="${escapeHTML(label)}" title="${escapeHTML(unavailable ? `Not available for the ${state.role} role` : label)}"${unavailable ? ' disabled' : ''}>${icon(glyph)}</button>`;
  }

  function badge(label, tone = 'info') {
    return `<span class="badge-status tone-${escapeHTML(tone)}">${escapeHTML(label)}</span>`;
  }

  function statusBadge(status) {
    const tone = ['Paid', 'Reviewed', 'Accepted', 'Filed', 'Active', 'On file'].includes(status) ? 'success' :
      ['Overdue', 'Needs Clarification'].includes(status) ? 'danger' :
      ['Open', 'Pending', 'For Review', 'Archived'].includes(status) ? 'warning' : 'info';
    return badge(status, tone);
  }

  function emptyState(title, description, label, action, options = {}, glyph = 'inbox') {
    return `<div class="empty-state"><div class="empty-icon">${icon(glyph)}</div><h2>${escapeHTML(title)}</h2>
      <p>${escapeHTML(description)}</p>${button(label, action, { tone: 'primary', small: true, ...options })}</div>`;
  }

  function listEmpty(collection) {
    const entity = ENTITY[collection];
    const filtered = state.query || state.filters.status !== 'All' || state.filters.client !== 'All' ||
      (collection === 'clients' && (state.filters.clientType !== 'All' || state.filters.archive !== 'All')) ||
      (collection === 'knowledge' && state.kbCategory !== 'All');
    return filtered && state.data[collection].length ?
      emptyState('No matching records', 'Try another search or clear your filters to see more records.', 'Clear filters', 'clear-filters', {}, 'search') :
      emptyState(`Your ${entity.label === 'entry' ? 'ledger review' : PAGES[entity.view].title.toLowerCase()} starts here`,
        `Add your first ${entity.label} to keep the team’s work organized.`, `New ${entity.label}`, 'new',
        { collection, permission: collection === 'invoices' ? 'billing' : '' }, entity.icon);
  }

  function statCard(label, value, note, glyph, tone = 'info') {
    return `<div class="col-sm-6 col-xl-3"><div class="panel stat"><div><div class="stat-label">${escapeHTML(label)}</div>
      <div class="stat-value">${escapeHTML(value)}</div><div class="stat-note">${escapeHTML(note)}</div></div>
      <span class="stat-icon tone-${escapeHTML(tone)}">${icon(glyph)}</span></div></div>`;
  }

  function progress(label, current, total) {
    const value = percent(current, total);
    return `<div class="metric-label"><span>${escapeHTML(label)}</span><span>${value}%</span></div>
      <progress class="metric-progress" value="${value}" max="100" aria-label="${escapeHTML(label)}">${value}%</progress>`;
  }

  function rowActions(collection, record) {
    const title = recordTitle(record);
    return `<div class="row-actions">
      ${iconButton(`View ${title}`, 'detail', collection, record.id, 'arrow-up-right')}
      ${iconButton(`Edit ${title}`, 'edit', collection, record.id, 'pencil', collection === 'invoices' ? 'billing' : '')}
      ${iconButton(`Delete ${title}`, 'delete', collection, record.id, 'trash3', 'manage')}
      </div>`;
  }

  function titleLink(collection, record, title = recordTitle(record)) {
    return `<button class="text-button" data-action="detail" data-collection="${escapeHTML(collection)}" data-id="${escapeHTML(record.id)}">${escapeHTML(title)}</button>`;
  }

  function optionList(values, selected) {
    return values.map(value => {
      const [key, label] = Array.isArray(value) ? value : [value, value];
      return `<option value="${escapeHTML(key)}"${key === selected ? ' selected' : ''}>${escapeHTML(label)}</option>`;
    }).join('');
  }

  function filtersHTML(collection, statuses = []) {
    return `<div class="filters"><label class="search-filter" for="listSearch">Search ${escapeHTML(PAGES[state.view].title.toLowerCase())}
      <input class="form-control" type="search" id="listSearch" data-filter="query" value="${escapeHTML(state.query)}" placeholder="Search names, references, or details…"></label>
      ${collection === 'clients' ? `<label for="clientTypeFilter">Client type<select id="clientTypeFilter" class="form-select" data-filter="clientType">${optionList(['All', ...CLIENT_TYPES], state.filters.clientType)}</select></label>
        <label for="archiveFilter">Client status<select id="archiveFilter" class="form-select" data-filter="archive">${optionList(['All', 'Active', 'Archived'], state.filters.archive)}</select></label>` : ''}
      ${!['clients', 'knowledge'].includes(collection) ? `<label for="clientFilter">Client<select id="clientFilter" class="form-select" data-filter="client">${optionList([['All', 'All clients'], ...state.data.clients.map(client => [client.id, client.name])], state.filters.client)}</select></label>` : ''}
      ${statuses.length ? `<label for="statusFilter">Status<select id="statusFilter" class="form-select" data-filter="status">${optionList(['All', ...statuses], state.filters.status)}</select></label>` : ''}
      ${button('Clear', 'clear-filters', { small: true })}</div>`;
  }

  function toolbar(collection, count, description) {
    const entity = ENTITY[collection];
    return `<div class="toolbar"><p class="toolbar-copy">${count} ${count === 1 ? 'record' : 'records'} · ${escapeHTML(description)}</p>
      ${button(`New ${entity.label}`, 'new', { collection, tone: 'primary', glyph: 'plus-lg', permission: collection === 'invoices' ? 'billing' : '' })}</div>`;
  }

  function tableHTML(caption, headers, body) {
    return `<div class="panel table-panel"><div class="table-responsive"><table class="table table-hover"><caption class="visually-hidden">${escapeHTML(caption)}</caption>
      <thead><tr>${headers.join('')}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function sortHeader(label, key, numeric = false) {
    const sort = state.sort[state.view] || { key: 'id', direction: 'asc' };
    const active = sort.key === key;
    return `<th scope="col"${numeric ? ' class="numeric"' : ''} aria-sort="${active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}">
      <button class="sort-button" data-action="sort" data-key="${escapeHTML(key)}">${escapeHTML(label)}${icon(active ? sort.direction === 'asc' ? 'arrow-up-short' : 'arrow-down-short' : 'arrow-down-up')}</button></th>`;
  }

  function sorted(rows) {
    const { key, direction } = state.sort[state.view] || { key: 'id', direction: 'asc' };
    const getValue = record => key === 'client' ? clientName(record.clientId) :
      key === 'status' && state.view === 'billing' ? invoiceStatus(record) : record[key];
    return [...rows].sort((a, b) => {
      const left = getValue(a), right = getValue(b);
      const result = typeof left === 'number' && typeof right === 'number' ? left - right :
        String(left ?? '').localeCompare(String(right ?? ''), 'en', { numeric: true, sensitivity: 'base' });
      return result * (direction === 'asc' ? 1 : -1);
    });
  }

  function filteredRows(collection) {
    return state.data[collection].filter(record => {
      const status = collection === 'invoices' ? invoiceStatus(record) : record.status;
      return matches(state.query, ...Object.values(record), status, record.clientId ? clientName(record.clientId) : '') &&
        (state.filters.status === 'All' || status === state.filters.status) &&
        (state.filters.client === 'All' || record.clientId === state.filters.client) &&
        (collection !== 'clients' || ((state.filters.clientType === 'All' || record.type === state.filters.clientType) &&
          (state.filters.archive === 'All' || record.status === state.filters.archive))) &&
        (collection !== 'knowledge' || state.kbCategory === 'All' || record.category === state.kbCategory);
    });
  }

  // ========================================================================
  // RENDER — orchestration only; render functions below return HTML strings.
  // ========================================================================
  function render(options = {}) {
    const focused = document.activeElement;
    const viewHadFocus = $('viewRoot').contains(focused);
    const focusedAction = viewHadFocus && focused?.dataset?.action ? { ...focused.dataset } : null;
    const focusId = options.keepFocus ? focused?.id : '';
    const selection = focusId && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const renderers = {
      overview: renderOverview, clients: renderClients, documents: renderDocuments,
      ledger: renderLedger, compliance: renderCompliance, billing: renderBilling,
      knowledge: renderKnowledge, workspace: renderWorkspace
    };
    $('pageTitle').textContent = PAGES[state.view].title;
    document.title = `${PAGES[state.view].title} · VERITAS CORE`;
    $('viewRoot').innerHTML = renderers[state.view]();
    $('viewRoot').setAttribute('aria-busy', 'false');
    document.querySelectorAll('#mainNav [data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('userName').textContent = state.user;
    $('userRole').textContent = state.role;
    $('avatar').textContent = state.user.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
    updateSaveStatus();
    renderNotifications();
    if (focusId && $(focusId)) {
      $(focusId).focus({ preventScroll: true });
      if (selection) try { $(focusId).setSelectionRange(...selection); } catch (error) { /* Non-text controls keep focus only. */ }
    } else if (viewHadFocus) {
      const replacement = focusedAction && [...$('viewRoot').querySelectorAll('[data-action]')].find(element =>
        Object.entries(focusedAction).every(([key, value]) => element.dataset[key] === value));
      (replacement || $('viewRoot')).focus({ preventScroll: true });
    }
  }

  function navigate(view) {
    if (!Object.hasOwn(PAGES, view)) return;
    searchInput.cancel();
    state.view = view;
    resetFilters();
    setSidebar(false);
    closeNotifications();
    render();
    $('viewRoot').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function resetFilters() {
    state.query = '';
    state.kbCategory = 'All';
    state.filters = { clientType: 'All', archive: 'All', status: 'All', client: 'All' };
  }

  // ========================================================================
  // VIEWS — overview, six record modules, workspace, detail, search, and alerts.
  // ========================================================================
  function renderOverview() {
    const data = state.data;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const active = data.clients.filter(client => client.status === 'Active').length;
    const pendingDocs = data.documents.filter(doc => !['Reviewed', 'Accepted'].includes(doc.status)).length;
    const pending = data.compliance.filter(record => record.status !== 'Filed');
    const overdue = pending.filter(record => daysUntil(record.dueDate) < 0).length;
    const upcoming = pending.filter(record => daysUntil(record.dueDate) >= 0 && daysUntil(record.dueDate) <= 10).length;
    const deadlines = [...pending].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
    const attention = data.documents.filter(docNeedsAttention).slice(0, 5);
    const outstanding = sum(data.invoices.filter(invoice => invoice.status !== 'Paid'), 'amount');
    const paid = data.invoices.filter(invoice => invoice.status === 'Paid').length;
    const date = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
    return `
      <section class="hero" aria-label="Workspace summary">
        <div class="eyebrow">A CLEARER VIEW OF YOUR PRACTICE</div>
        <h2 class="hero-title">${greeting}, ${escapeHTML(state.user)}.</h2>
        <div class="hero-date">${escapeHTML(date)}</div>
        <p class="hero-summary">${overdue ? `${overdue} overdue ${overdue === 1 ? 'filing needs' : 'filings need'} your attention.` : 'Your filing schedule is on track.'} ${upcoming} ${upcoming === 1 ? 'deadline is' : 'deadlines are'} approaching in the next 10 days.</p>
        <div class="hero-bottom"><span class="hero-note">${icon('shield-check')}One workspace. Every detail accounted for.</span>
          ${button('Review deadlines', 'navigate', { view: 'compliance', tone: 'primary', glyph: 'arrow-up-right' })}</div>
      </section>
      <div class="toolbar"><h2 class="section-title">Your daily overview</h2><div class="actions">
        ${button('New client', 'new', { collection: 'clients', small: true, glyph: 'person-plus' })}
        ${button('Add document', 'new', { collection: 'documents', small: true, glyph: 'upload' })}
        ${button('New invoice', 'new', { collection: 'invoices', small: true, glyph: 'plus-lg', permission: 'billing' })}
      </div></div>
      <div class="row g-3 mb-4">
        ${statCard('Active clients', active, 'Across your practice', 'people')}
        ${statCard('Documents in progress', pendingDocs, 'Awaiting review or clarification', 'folder2-open', 'info')}
        ${statCard('Due within 10 days', upcoming, 'Start preparation early', 'calendar2-week', upcoming ? 'warning' : 'success')}
        ${statCard('Overdue filings', overdue, overdue ? 'Follow-up required' : 'All clear for now', 'exclamation-circle', overdue ? 'danger' : 'success')}
      </div>
      <div class="row g-3 mb-4"><div class="col-xl-8"><section class="panel table-panel">
        <div class="panel-heading"><div><h2 class="section-title">Compliance watch</h2><p class="section-description">Your next unresolved filings</p></div>
          ${button('View all', 'navigate', { view: 'compliance', small: true })}</div>
        ${deadlines.length ? `<div class="table-responsive"><table class="table table-hover"><caption class="visually-hidden">Next six unresolved filings</caption><thead><tr><th scope="col">Client & requirement</th><th scope="col">Agency</th><th scope="col">Due date</th><th scope="col">Status</th></tr></thead><tbody>
          ${deadlines.map(record => { const status = deadlineStatus(record); return `<tr><td>${titleLink('compliance', record)}<div class="subtext">${escapeHTML(clientName(record.clientId))}</div></td><td>${escapeHTML(record.agency)}</td><td>${dateFmt(record.dueDate)}</td><td>${badge(status.text, status.tone)}</td></tr>`; }).join('')}
          </tbody></table></div>` : emptyState('Nothing overdue. Nothing overlooked.', 'Add a deadline to plan your next filing.', 'New deadline', 'new', { collection: 'compliance' }, 'calendar-check')}
      </section></div><div class="col-xl-4"><section class="panel panel-pad">
        <div class="toolbar"><h2 class="section-title">Billing snapshot</h2>${badge(`${data.invoices.length - paid} open`, 'info')}</div>
        <div class="billing-total">${money(outstanding)}</div><p class="subtext mb-4">Total outstanding balance</p>
        ${progress('Invoices paid', paid, data.invoices.length)}<p class="section-description mt-2">${paid} of ${data.invoices.length} invoices settled</p>
        <div class="mt-4">${button('Open billing', 'navigate', { view: 'billing', small: true, glyph: 'arrow-up-right' })}</div>
      </section></div></div>
      <div class="row g-3"><div class="col-xl-6"><section class="panel panel-pad">
        <h2 class="section-title">Documents needing attention</h2><p class="section-description">Resolve missing information and approaching due dates</p>
        ${attention.length ? `<ul class="timeline">${attention.map(doc => `<li>${icon('file-earmark-text')}<div class="timeline-content">${titleLink('documents', doc)}<div class="subtext">${escapeHTML(clientName(doc.clientId))} · ${escapeHTML(doc.status)}</div></div></li>`).join('')}</ul>` : emptyState('Your document queue is clear', 'Reviewed and accepted documents are safely out of your attention queue.', 'View documents', 'navigate', { view: 'documents' }, 'check2-circle')}
      </section></div><div class="col-xl-6"><section class="panel panel-pad">
        <h2 class="section-title">Recent activity</h2><p class="section-description">The latest changes in this workspace</p>
        ${data.activity.length ? `<ul class="timeline">${data.activity.slice(0, 6).map(item => `<li>${icon('clock-history')}<div class="timeline-content">${escapeHTML(item.text)}<div class="subtext">${escapeHTML(timeFmt(item.at))}</div></div></li>`).join('')}</ul>` : emptyState('A fresh page for your team', 'Saved changes will appear here as you work.', 'Add a client', 'new', { collection: 'clients' }, 'clock-history')}
      </section></div></div>`;
  }

  function renderClients() {
    const rows = sorted(filteredRows('clients'));
    const headings = [sortHeader('Client ID', 'id'), sortHeader('Client', 'name'), sortHeader('Type', 'type'),
      '<th scope="col">Registration</th>', sortHeader('Status', 'status'), '<th scope="col" class="text-end">Actions</th>'];
    return toolbar('clients', rows.length, 'Relationships, records, and registration') + filtersHTML('clients') +
      (rows.length ? tableHTML('Client directory', headings, rows.map(client => `<tr>
        <td class="subtext">${escapeHTML(client.id)}</td><td>${titleLink('clients', client)}<div class="subtext">${escapeHTML(client.contact || 'Contact not set')}</div></td>
        <td>${escapeHTML(client.type)}</td><td><div class="actions">${badge(`CBL: ${client.cbl}`, client.cbl === 'On file' ? 'success' : 'warning')}${badge(`COR: ${client.cor}`, client.cor === 'On file' ? 'success' : 'warning')}</div></td>
        <td>${statusBadge(client.status)}</td><td><div class="row-actions">${iconButton(client.status === 'Active' ? 'Archive client' : 'Restore client', 'archive', 'clients', client.id, client.status === 'Active' ? 'archive' : 'arrow-counterclockwise', 'manage')}${rowActions('clients', client)}</div></td>
        </tr>`).join('')) : `<section class="panel">${listEmpty('clients')}</section>`);
  }

  function renderDocuments() {
    const rows = sorted(filteredRows('documents'));
    const headings = [sortHeader('Document', 'title'), sortHeader('Client', 'client'), sortHeader('Received', 'receivedDate'),
      sortHeader('Status', 'status'), '<th scope="col">Attachment</th>', '<th scope="col" class="text-end">Actions</th>'];
    return toolbar('documents', rows.length, 'Intake, review, and a complete client file') + filtersHTML('documents', DOC_STATUSES) +
      (rows.length ? tableHTML('Document intake log', headings, rows.map(doc => `<tr>
        <td>${titleLink('documents', doc)}<div class="subtext">${escapeHTML(doc.type)}</div></td><td>${escapeHTML(clientName(doc.clientId))}</td>
        <td>${dateFmt(doc.receivedDate)}</td><td>${statusBadge(doc.status)}</td><td>${doc.fileKey ? button('Download', 'download', { collection: 'documents', id: doc.id, small: true, glyph: 'download' }) : '<span class="subtext">Not attached</span>'}</td>
        <td>${rowActions('documents', doc)}</td></tr>`).join('')) : `<section class="panel">${listEmpty('documents')}</section>`);
  }

  function renderLedger() {
    const rows = sorted(filteredRows('transactions'));
    const debit = sum(rows, 'debit'), credit = sum(rows, 'credit');
    const difference = Math.round((debit - credit) * 100) / 100;
    const reviewed = rows.filter(record => record.status === 'Reviewed').length;
    const headings = [sortHeader('Date', 'date'), sortHeader('Client', 'client'), sortHeader('Entry / account', 'description'),
      sortHeader('Debit', 'debit', true), sortHeader('Credit', 'credit', true), sortHeader('Status', 'status'), '<th scope="col" class="text-end">Actions</th>'];
    return `<div class="row g-3 mb-4">
      ${statCard('Displayed debits', money(debit), 'Current search and filters', 'arrow-down-left')}
      ${statCard('Displayed credits', money(credit), 'Current search and filters', 'arrow-up-right')}
      ${statCard('Difference', money(Math.abs(difference)), difference === 0 ? 'Displayed totals balance' : 'Displayed entries need review', 'arrow-left-right', difference === 0 ? 'success' : 'danger')}
      ${statCard('Reviewed entries', reviewed, `${rows.length - reviewed} awaiting review`, 'check2-square', 'success')}
      </div>` + toolbar('transactions', rows.length, 'Review entries here; post approved entries in your general ledger system') + filtersHTML('transactions', ['For Review', 'Reviewed']) +
      (rows.length ? tableHTML('Ledger review entries', headings, rows.map(record => `<tr>
        <td>${dateFmt(record.date)}<div class="subtext">${escapeHTML(record.reference)}</div></td><td>${escapeHTML(clientName(record.clientId))}</td>
        <td>${titleLink('transactions', record)}<div class="subtext">${escapeHTML(record.account)}</div></td>
        <td class="numeric">${record.debit ? money(record.debit) : '—'}</td><td class="numeric">${record.credit ? money(record.credit) : '—'}</td>
        <td>${statusBadge(record.status)}</td><td>${rowActions('transactions', record)}</td></tr>`).join('')) : `<section class="panel">${listEmpty('transactions')}</section>`);
  }

  function renderCompliance() {
    const rows = filteredRows('compliance').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return toolbar('compliance', rows.length, 'Prepare 10 days ahead of each confirmed deadline') + filtersHTML('compliance', ['Pending', 'Filed']) +
      `<div class="row g-3">${rows.length ? rows.map(record => {
        const status = deadlineStatus(record);
        return `<div class="col-md-6 col-xl-4"><article class="panel deadline-card ${status.className}">
          <div class="toolbar mb-0">${badge(record.agency)}${badge(status.text, status.tone)}</div>
          <h2>${titleLink('compliance', record)}</h2><div class="subtext">${escapeHTML(clientName(record.clientId))}</div>
          <div class="deadline-date">${icon('calendar3')} Due ${dateFmt(record.dueDate)}</div>
          <p class="section-description">${record.status === 'Filed' ? `Filed ${dateFmt(record.filedDate)}` : daysUntil(record.dueDate) <= 10 ? 'Preparation window is open. Confirm supporting records.' : `Preparation starts ${dateFmt(offsetISO(record.dueDate, -10))}.`}</p>
          <div class="actions">${button(record.status === 'Filed' ? 'Reopen' : 'Mark filed', 'filed', { collection: 'compliance', id: record.id, small: true })}
            ${iconButton('Edit deadline', 'edit', 'compliance', record.id, 'pencil')}${iconButton('Delete deadline', 'delete', 'compliance', record.id, 'trash3', 'manage')}</div>
          </article></div>`;
      }).join('') : `<div class="col-12"><section class="panel">${listEmpty('compliance')}</section></div>`}</div>`;
  }

  function offsetISO(value, offset) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + offset);
    return localISO(date);
  }

  function renderBilling() {
    const rows = sorted(filteredRows('invoices'));
    const open = rows.filter(invoice => invoice.status !== 'Paid');
    const overdue = rows.filter(invoice => invoiceStatus(invoice) === 'Overdue');
    const headings = [sortHeader('Invoice', 'id'), sortHeader('Client', 'client'), sortHeader('Due date', 'dueDate'),
      sortHeader('Amount', 'amount', true), sortHeader('Status', 'status'), '<th scope="col" class="text-end">Actions</th>'];
    return `<div class="row g-3 mb-4">
      ${statCard('Outstanding balance', money(sum(open, 'amount')), 'Displayed open and overdue invoices', 'receipt')}
      ${statCard('Overdue balance', money(sum(overdue, 'amount')), `${overdue.length} invoices past due`, 'exclamation-circle', overdue.length ? 'danger' : 'success')}
      ${statCard('Paid invoices', rows.length - open.length, 'Payments recorded', 'check2-circle', 'success')}
      ${statCard('Invoices shown', rows.length, 'Current search and filters', 'files')}
      </div>` + toolbar('invoices', rows.length, 'Track services, due dates, and payments') + filtersHTML('invoices', ['Open', 'Overdue', 'Paid']) +
      (rows.length ? tableHTML('Client invoices', headings, rows.map(invoice => `<tr>
        <td>${titleLink('invoices', invoice, invoice.id)}<div class="subtext">${escapeHTML(invoice.description)}</div></td><td>${escapeHTML(clientName(invoice.clientId))}</td>
        <td>${dateFmt(invoice.dueDate)}</td><td class="numeric">${money(invoice.amount)}</td><td>${statusBadge(invoiceStatus(invoice))}</td>
        <td><div class="row-actions">${invoice.status !== 'Paid' ? iconButton('Mark invoice paid', 'mark-paid', 'invoices', invoice.id, 'check2-circle', 'billing') : ''}${rowActions('invoices', invoice)}</div></td></tr>`).join('')) : `<section class="panel">${listEmpty('invoices')}</section>`);
  }

  function renderKnowledge() {
    const rows = filteredRows('knowledge');
    return toolbar('knowledge', rows.length, 'The way your team works, in one shared reference') + filtersHTML('knowledge') +
      `<div class="category-chips" aria-label="Article categories">${['All', ...CATEGORIES].map(category => `<button class="chip${state.kbCategory === category ? ' active' : ''}" data-action="category" data-category="${escapeHTML(category)}" aria-pressed="${state.kbCategory === category}">${escapeHTML(category)}</button>`).join('')}</div>
      <div class="row g-3">${rows.length ? rows.map(article => `<div class="col-md-6 col-xl-4"><article class="panel article-card">
        <div>${badge(article.category)}</div><h2>${titleLink('knowledge', article)}</h2><p class="article-preview">${escapeHTML(article.content)}</p>
        <div class="actions pt-0 mt-0">${article.tags.map(tag => `<span class="tag">#${escapeHTML(tag)}</span>`).join('')}</div>
        <div class="actions">${button('Read article', 'detail', { collection: 'knowledge', id: article.id, small: true })}
          ${iconButton('Edit article', 'edit', 'knowledge', article.id, 'pencil')}${iconButton('Delete article', 'delete', 'knowledge', article.id, 'trash3', 'manage')}</div>
      </article></div>`).join('') : `<div class="col-12"><section class="panel">${listEmpty('knowledge')}</section></div>`}</div>`;
  }

  function renderWorkspace() {
    return `<div class="toolbar"><p class="toolbar-copy">Your preferences, records, and local storage</p>${badge('Local workspace', 'info')}</div>
      <div class="row g-4"><div class="col-lg-6"><section class="panel panel-pad">
        <h2 class="section-title">Your workspace profile</h2><p class="section-description mb-4">Personalize your session on this browser.</p>
        <form id="settingsForm"><div class="mb-3"><label class="form-label" for="settingName">Display name</label><input id="settingName" name="user" class="form-control" value="${escapeHTML(state.user)}" required maxlength="80"></div>
          <div class="mb-3"><label class="form-label" for="settingRole">Change access role</label><select class="form-select" id="settingRole" name="role">${optionList(Object.keys(ROLES), state.role)}</select>
          <div class="form-text">Roles control available actions in this browser. They do not provide account authentication.</div></div>
          <button class="btn btn-primary" type="submit">Save preferences</button></form>
      </section></div><div class="col-lg-6"><section class="panel panel-pad">
        <h2 class="section-title">Workspace records</h2><p class="section-description mb-3">Last saved ${escapeHTML(timeFmt(state.data.meta.lastSaved))}</p>
        ${COLLECTIONS.map(collection => `<div class="data-count"><span>${escapeHTML(PAGES[ENTITY[collection].view].title)}</span><strong>${state.data[collection].length}</strong></div>`).join('')}
      </section></div><div class="col-lg-8"><section class="panel panel-pad">
        <h2 class="section-title">Backup & transfer</h2><p class="subtext mt-2">Workspace records are saved in this browser. Export a backup to keep a separate copy or move your records.</p>
        <p class="subtext">JSON backups contain structured records, including client details. Attachments stay in this browser and are not included; keep original files separately.</p>
        <div class="actions mt-4">${button('Export JSON', 'export-json', { tone: 'primary', glyph: 'download' })}
          ${button('Import JSON', 'import', { permission: 'import', glyph: 'upload' })}${button('Export clients CSV', 'export-csv', { glyph: 'filetype-csv' })}</div>
      </section></div><div class="col-lg-4"><section class="panel panel-pad danger-zone">
        <h2 class="section-title">Reset workspace</h2><p class="subtext mt-2">Remove all records and attachments from this workspace. Export a backup and keep original files before starting fresh.</p>
        <p class="section-description mb-4">Available to the Owner role.</p>${button('Reset workspace', 'reset', { permission: 'reset', tone: 'outline-danger', glyph: 'arrow-counterclockwise' })}
      </section></div></div>`;
  }

  function detailFields(pairs) {
    return `<dl class="detail-grid">${pairs.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value || 'Not set')}</dd></div>`).join('')}</dl>`;
  }

  function openClientDetail(id) {
    const client = getRecord('clients', id);
    if (!client) throw new Error('This client no longer exists.');
    const docs = state.data.documents.filter(doc => doc.clientId === id);
    const filings = state.data.compliance.filter(record => record.clientId === id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const outstanding = sum(state.data.invoices.filter(invoice => invoice.clientId === id && invoice.status !== 'Paid'), 'amount');
    const body = `${statusBadge(client.status)}<div class="mt-4">${detailFields([
      ['Client ID', client.id], ['Entity type', client.type], ['Contact', client.contact], ['Email', client.email],
      ['Phone', client.phone], ['TIN', client.tin], ['Business license', client.cbl], ['Registration certificate', client.cor]
    ])}</div><div class="mini-stats"><div class="mini-stat"><strong>${docs.length}</strong><span>Documents</span></div>
      <div class="mini-stat"><strong>${filings.filter(record => record.status !== 'Filed').length}</strong><span>Open deadlines</span></div>
      <div class="mini-stat"><strong>${money(outstanding)}</strong><span>Outstanding balance</span></div></div>
      <h3 class="section-title mt-4">Compliance</h3>
      ${filings.length ? `<ul class="timeline">${filings.map(record => `<li><div class="timeline-content">${escapeHTML(record.requirement)}<div class="subtext">${escapeHTML(record.agency)} · ${dateFmt(record.dueDate)}</div></div>${statusBadge(record.status)}</li>`).join('')}</ul>` : '<p class="subtext mt-2">No deadlines are linked to this client yet.</p>'}
      <h3 class="section-title mt-4">Documents</h3>
      ${docs.length ? `<ul class="timeline">${docs.map(doc => `<li><div class="timeline-content">${escapeHTML(doc.title)}<div class="subtext">Received ${dateFmt(doc.receivedDate)}</div></div>${statusBadge(doc.status)}</li>`).join('')}</ul>` : '<p class="subtext mt-2">No documents are linked to this client yet.</p>'}
      ${client.notes ? `<h3 class="section-title mt-4">Notes</h3><p class="prose mt-2">${escapeHTML(client.notes)}</p>` : ''}`;
    openDetail(client.name, body, detailFooter('clients', id), { collection: 'clients', id });
  }

  function detailFooter(collection, id) {
    return `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
      ${button('Print', 'print', { glyph: 'printer' })}${button('Edit record', 'detail-edit', {
        collection, id, tone: 'primary', permission: collection === 'invoices' ? 'billing' : ''
      })}`;
  }

  function openRecordDetail(collection, id) {
    if (collection === 'clients') return openClientDetail(id);
    const record = getRecord(collection, id);
    if (!record) throw new Error('This record no longer exists.');
    const pairs = [['Record ID', record.id]];
    if (record.clientId) pairs.push(['Client', clientName(record.clientId)]);
    let extra = '';
    if (collection === 'documents') {
      pairs.push(['Type', record.type], ['Status', record.status], ['Received', dateFmt(record.receivedDate)], ['Follow-up date', dateFmt(record.dueDate)], ['Attachment', record.fileName || 'Not attached']);
      if (record.fileKey) extra = button('Download attachment', 'download', { collection, id, glyph: 'download' });
    } else if (collection === 'transactions') {
      pairs.push(['Date', dateFmt(record.date)], ['Reference', record.reference], ['Account', record.account], ['Debit', money(record.debit)], ['Credit', money(record.credit)], ['Review status', record.status]);
    } else if (collection === 'compliance') {
      pairs.push(['Agency', record.agency], ['Due date', dateFmt(record.dueDate)], ['Status', record.status], ['Filed date', dateFmt(record.filedDate)]);
    } else if (collection === 'invoices') {
      pairs.push(['Invoice date', dateFmt(record.date)], ['Due date', dateFmt(record.dueDate)], ['Amount', money(record.amount)], ['Status', invoiceStatus(record)]);
    } else if (collection === 'knowledge') {
      pairs.push(['Category', record.category]);
      extra = `<div class="actions mb-4">${record.tags.map(tag => `<span class="tag">#${escapeHTML(tag)}</span>`).join('')}</div><div class="prose">${escapeHTML(record.content)}</div>`;
    }
    openDetail(recordTitle(record), detailFields(pairs) + extra +
      (record.notes ? `<h3 class="section-title mt-4">Notes</h3><p class="prose mt-2">${escapeHTML(record.notes)}</p>` : ''),
      detailFooter(collection, id), { collection, id });
  }

  function computeNotifications() {
    const notifications = [];
    for (const record of state.data.compliance) {
      const days = daysUntil(record.dueDate);
      if (record.status !== 'Filed' && days <= 10) notifications.push({
        key: `filing:${record.id}:${record.dueDate}:${days < 0 ? 'late' : 'soon'}`,
        collection: 'compliance', id: record.id, icon: 'calendar2-check',
        title: `${days < 0 ? 'Overdue' : days === 0 ? 'Due today' : 'Prepare now'}: ${record.requirement}`,
        description: `${clientName(record.clientId)} · ${dateFmt(record.dueDate)}`, priority: days < 0 ? 0 : 2
      });
    }
    for (const invoice of state.data.invoices.filter(item => invoiceStatus(item) === 'Overdue')) {
      notifications.push({ key: `invoice:${invoice.id}:${invoice.dueDate}`, collection: 'invoices', id: invoice.id,
        icon: 'receipt', title: `Overdue invoice: ${invoice.id}`, description: `${clientName(invoice.clientId)} · ${money(invoice.amount)}`, priority: 1 });
    }
    for (const doc of state.data.documents.filter(docNeedsAttention)) {
      notifications.push({ key: `document:${doc.id}:${doc.status}:${doc.dueDate}`, collection: 'documents', id: doc.id,
        icon: 'file-earmark-text', title: doc.title, description: `${clientName(doc.clientId)} · ${doc.status}`, priority: 3 });
    }
    return notifications.sort((a, b) => a.priority - b.priority);
  }

  function renderNotifications() {
    const items = computeNotifications();
    const unread = items.filter(item => !state.readNotifications.has(item.key)).length;
    $('notificationDot').hidden = unread === 0;
    $('notificationTrigger').setAttribute('aria-label', `Notifications, ${unread} unread`);
    $('notificationPanel').innerHTML = `<div class="panel-heading"><div><h2 class="section-title">Your attention, here</h2><p class="section-description">${items.length} items to follow up</p></div>
      ${button('Mark read', 'read-notifications', { small: true })}</div>` +
      (items.length ? items.map(item => `<button class="notification-item" data-action="notification-detail" data-collection="${escapeHTML(item.collection)}" data-id="${escapeHTML(item.id)}" data-key="${escapeHTML(item.key)}">
        ${icon(item.icon)}<span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.description)}</small></span></button>`).join('') :
        emptyState('You’re all caught up', 'No overdue filings, invoices, or flagged documents need your attention.', 'View overview', 'navigate', { view: 'overview' }, 'check2-circle'));
  }

  function closeNotifications() {
    $('notificationPanel').hidden = true;
    $('notificationTrigger').setAttribute('aria-expanded', 'false');
  }

  function searchWorkspace(query) {
    const results = [];
    Object.entries(PAGES).forEach(([view, page]) => {
      if (matches(query, page.title, page.description)) results.push({ group: 'Pages', title: page.title, subtitle: 'Open page', icon: page.icon, action: 'navigate', view });
    });
    Object.entries(ENTITY).forEach(([collection, entity]) => {
      if (collection === 'invoices' && !can('billing')) return;
      const title = `New ${entity.label}`;
      if (matches(query, title, collection)) results.push({ group: 'Actions', title, subtitle: PAGES[entity.view].title, icon: 'plus-circle', action: 'new', collection });
    });
    const workspaceActions = [
      ['Export JSON backup', 'export-json', 'download'],
      ['Export clients CSV', 'export-csv', 'filetype-csv'],
      ['Import JSON backup', 'import', 'upload'],
      ['Reset workspace', 'reset', 'arrow-counterclockwise']
    ];
    workspaceActions.forEach(([title, action, glyph]) => {
      const permission = actionPermission(action);
      if ((!permission || can(permission)) && matches(query, title)) {
        results.push({ group: 'Actions', title, subtitle: 'Workspace data', icon: glyph, action });
      }
    });
    for (const collection of COLLECTIONS) {
      let count = 0;
      for (const record of state.data[collection]) {
        if (count >= 6) break;
        const subtitle = record.clientId ? clientName(record.clientId) : record.id;
        if (matches(query, recordTitle(record), record.id, subtitle, record.category, record.tags, record.content, record.status, record.agency)) {
          results.push({ group: PAGES[ENTITY[collection].view].title, title: recordTitle(record), subtitle,
            icon: ENTITY[collection].icon, action: 'detail', collection, id: record.id });
          count++;
        }
      }
    }
    return results;
  }

  function renderCommand() {
    state.cmdk.results = searchWorkspace(state.cmdk.query);
    state.cmdk.index = Math.max(0, Math.min(state.cmdk.index, state.cmdk.results.length - 1));
    let previousGroup = '';
    $('commandResults').innerHTML = state.cmdk.results.length ? state.cmdk.results.map((result, index) => {
      const group = result.group !== previousGroup ? `<div class="command-group" role="presentation">${escapeHTML(result.group)}</div>` : '';
      previousGroup = result.group;
      return `${group}<div class="command-result" id="commandOption${index}" role="option" aria-selected="${index === state.cmdk.index}" data-command-index="${index}">
        ${icon(result.icon)}<span>${escapeHTML(result.title)}<small>${escapeHTML(result.subtitle)}</small></span></div>`;
    }).join('') : '<div class="empty-state"><div class="empty-icon"><i class="bi bi-search" aria-hidden="true"></i></div><h3>No matches found</h3><p>Try a client name, document title, or “new invoice”.</p></div>';
    updateCommandSelection();
    $('commandStatus').textContent = `${state.cmdk.results.length} results`;
  }

  function updateCommandSelection() {
    $('commandResults').querySelectorAll('[role="option"]').forEach((element, index) => {
      element.setAttribute('aria-selected', String(index === state.cmdk.index));
    });
    const active = $(`commandOption${state.cmdk.index}`);
    if (active) {
      $('commandInput').setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else $('commandInput').removeAttribute('aria-activedescendant');
  }

  function openCommand() {
    if ($('formModal').classList.contains('show') || $('detailModal').classList.contains('show')) return;
    closeNotifications();
    setSidebar(false);
    state.cmdk.returnFocus = document.activeElement;
    state.cmdk.open = true;
    state.cmdk.query = '';
    state.cmdk.index = 0;
    $('commandInput').value = '';
    $('commandPalette').showModal();
    renderCommand();
    $('commandInput').focus();
  }

  function closeCommand() {
    if ($('commandPalette').open) $('commandPalette').close();
    state.cmdk.open = false;
    state.cmdk.returnFocus?.focus({ preventScroll: true });
  }

  async function chooseCommand(index) {
    const result = state.cmdk.results[index];
    if (!result) return;
    closeCommand();
    await dispatchAction(result);
  }

  // ========================================================================
  // FORMS — explicit labels, native constraints, plus schema validation on save.
  // ========================================================================
  function field(label, name, value = '', options = {}) {
    const { type = 'text', required = false, width = 6, max = 250, min, step, help = '' } = options;
    const id = `field_${name}`;
    return `<div class="col-md-${width}"><label class="form-label" for="${id}">${escapeHTML(label)}${required ? ' <span class="required-mark" aria-hidden="true">*</span>' : ''}</label>
      <input class="form-control" id="${id}" name="${escapeHTML(name)}" type="${type}" value="${escapeHTML(value)}"${required ? ' required' : ''}
      ${['number', 'date', 'file'].includes(type) ? '' : `maxlength="${max}"`}${min !== undefined ? ` min="${escapeHTML(min)}"` : ''}${step ? ` step="${escapeHTML(step)}"` : ''}${help ? ` aria-describedby="${id}_help"` : ''}>
      ${help ? `<div class="form-text" id="${id}_help">${escapeHTML(help)}</div>` : ''}</div>`;
  }

  function selectField(label, name, values, selected, width = 6, required = true) {
    return `<div class="col-md-${width}"><label class="form-label" for="field_${name}">${escapeHTML(label)}${required ? ' <span class="required-mark" aria-hidden="true">*</span>' : ''}</label>
      <select class="form-select" id="field_${name}" name="${escapeHTML(name)}"${required ? ' required' : ''}>${optionList(values, selected)}</select></div>`;
  }

  function textareaField(label, name, value = '', required = false, max = 2000) {
    return `<div class="col-12"><label class="form-label" for="field_${name}">${escapeHTML(label)}${required ? ' <span class="required-mark" aria-hidden="true">*</span>' : ''}</label>
      <textarea class="form-control" id="field_${name}" name="${escapeHTML(name)}" rows="${name === 'content' ? 9 : 3}" maxlength="${max}"${required ? ' required' : ''}>${escapeHTML(value)}</textarea></div>`;
  }

  function clientField(selected = '') {
    const clients = state.data.clients.filter(client => client.status === 'Active' || client.id === selected);
    return selectField('Client', 'clientId', [['', 'Choose a client'], ...clients.map(client => [client.id, client.name])], selected);
  }

  function clientForm(record = {}) {
    return field('Business name', 'name', record.name, { required: true, max: 180 }) +
      selectField('Entity type', 'type', CLIENT_TYPES, record.type || CLIENT_TYPES[0]) +
      field('Contact person', 'contact', record.contact, { max: 180 }) + field('Email', 'email', record.email, { type: 'email', max: 254 }) +
      field('Phone', 'phone', record.phone, { type: 'tel', max: 60 }) + field('TIN', 'tin', record.tin, { max: 80 }) +
      selectField('Business license', 'cbl', ['Pending', 'On file'], record.cbl || 'Pending') +
      selectField('Registration certificate', 'cor', ['Pending', 'On file'], record.cor || 'Pending') + textareaField('Notes', 'notes', record.notes);
  }

  function documentForm(record = {}) {
    return clientField(record.clientId) + selectField('Document type', 'type', DOC_TYPES, record.type || DOC_TYPES[0]) +
      field('Document title', 'title', record.title, { required: true, width: 8 }) +
      selectField('Review status', 'status', DOC_STATUSES, record.status || 'Submitted', 4) +
      field('Received date', 'receivedDate', record.receivedDate || localISO(), { type: 'date', required: true }) +
      field('Follow-up date', 'dueDate', record.dueDate, { type: 'date' }) +
      `<div class="col-12"><label class="form-label" for="field_file">Attachment</label><input class="form-control" type="file" id="field_file" name="file" aria-describedby="fileHelp">
        <div class="form-text" id="fileHelp">Up to 20 MB. Stored only in this browser.${record.fileName ? ` Current file: ${escapeHTML(record.fileName)}.` : ''}</div>
        ${record.fileKey ? '<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="field_removeFile" name="removeFile"><label class="form-check-label" for="field_removeFile">Remove current attachment</label></div>' : ''}</div>` + textareaField('Notes', 'notes', record.notes);
  }

  function transactionForm(record = {}) {
    return clientField(record.clientId) + field('Entry date', 'date', record.date || localISO(), { type: 'date', required: true }) +
      field('Reference', 'reference', record.reference, { max: 100 }) + field('Account', 'account', record.account, { required: true, max: 180 }) +
      field('Description', 'description', record.description, { required: true, width: 12 }) +
      field('Debit', 'debit', record.debit || 0, { type: 'number', min: 0, step: '.01', width: 4 }) +
      field('Credit', 'credit', record.credit || 0, { type: 'number', min: 0, step: '.01', width: 4 }) +
      selectField('Review status', 'status', ['For Review', 'Reviewed'], record.status || 'For Review', 4) +
      '<p class="form-text col-12 mb-0">Enter a debit or a credit for each entry. Review and reconcile here before posting in your general ledger system.</p>';
  }

  function complianceForm(record = {}) {
    return clientField(record.clientId) + selectField('Agency', 'agency', AGENCIES, record.agency || 'BIR') +
      field('Requirement', 'requirement', record.requirement, { required: true, width: 12 }) +
      field('Confirmed due date', 'dueDate', record.dueDate || shiftDate(10), { type: 'date', required: true, width: 12, help: 'Preparation is flagged 10 days ahead of this date.' }) +
      textareaField('Notes', 'notes', record.notes);
  }

  function invoiceForm(record = {}) {
    return clientField(record.clientId) + field('Amount (PHP)', 'amount', record.amount ?? '', { type: 'number', min: '.01', step: '.01', required: true }) +
      field('Invoice date', 'date', record.date || localISO(), { type: 'date', required: true }) +
      field('Due date', 'dueDate', record.dueDate || shiftDate(15), { type: 'date', required: true }) +
      field('Description', 'description', record.description, { required: true, width: 12 }) +
      selectField('Payment status', 'status', ['Open', 'Paid'], record.status || 'Open', 12);
  }

  function knowledgeForm(record = {}) {
    return field('Article title', 'title', record.title, { required: true, width: 8 }) +
      selectField('Category', 'category', CATEGORIES, record.category || 'Procedure', 4) +
      field('Tags', 'tags', (record.tags || []).join(', '), { width: 12, max: 1200, help: 'Separate tags with commas. Up to 20 tags.' }) +
      textareaField('Article content', 'content', record.content, true, 30000);
  }

  function openRecordForm(collection, id = '') {
    if (!Object.hasOwn(ENTITY, collection)) throw new Error('Unknown record type.');
    if (collection === 'invoices') enforce('billing');
    const record = id ? getRecord(collection, id) : null;
    if (id && !record) throw new Error('This record no longer exists.');
    if (!['clients', 'knowledge'].includes(collection) && !record && !state.data.clients.some(client => client.status === 'Active')) {
      toast('Add or restore an active client before creating this record.', true);
      navigate('clients');
      return;
    }
    const forms = { clients: clientForm, documents: documentForm, transactions: transactionForm,
      compliance: complianceForm, invoices: invoiceForm, knowledge: knowledgeForm };
    rememberFocus();
    state.form = { collection, id };
    $('formModalTitle').textContent = `${id ? 'Edit' : 'New'} ${ENTITY[collection].label}`;
    $('formModalBody').innerHTML = `<p class="form-text mt-0">Fields marked * are required.</p><div class="row g-3">${forms[collection](record || {})}</div>`;
    $('formError').hidden = true;
    $('formSave').disabled = false;
    $('formSave').textContent = 'Save record';
    state.formModal.show();
  }

  async function saveRecord(event) {
    event.preventDefault();
    if (state.busy || !state.form) return;
    const form = $('recordForm');
    if (!form.reportValidity()) return;
    state.busy = true;
    $('formSave').disabled = true;
    $('formSave').textContent = 'Saving…';
    let newFileKey = '';
    let committed = false;
    try {
      const { collection, id } = state.form;
      if (collection === 'invoices') enforce('billing');
      const previous = id ? getRecord(collection, id) : null;
      if (id && !previous) throw new Error('This record no longer exists.');
      const values = Object.fromEntries(new FormData(form).entries());
      const candidate = { ...previous, ...values, id: id || uid(ENTITY[collection].prefix) };
      if (collection === 'clients') {
        candidate.status = previous?.status || 'Active';
        candidate.createdAt = previous?.createdAt || localISO();
      }
      if (candidate.clientId && !getRecord('clients', candidate.clientId)) throw new Error('Choose an existing client.');
      if (collection === 'compliance') {
        candidate.status = previous?.status || 'Pending';
        candidate.filedDate = previous?.filedDate || '';
      }
      if (collection === 'invoices') candidate.amount = Number(values.amount);
      if (collection === 'transactions') {
        candidate.debit = Number(values.debit);
        candidate.credit = Number(values.credit);
      }
      if (collection === 'knowledge') candidate.tags = values.tags.split(',').map(tag => tag.trim()).filter(Boolean);
      if (collection === 'documents') {
        candidate.fileKey = previous?.fileKey || '';
        candidate.fileName = previous?.fileName || '';
        if (values.removeFile) { candidate.fileKey = ''; candidate.fileName = ''; }
      }
      // Validate structured fields before any file write.
      let record = validateRecord(collection, candidate);
      if (collection === 'documents') {
        const file = $('field_file').files[0];
        if (file) {
          newFileKey = uid('FILE');
          await storeFile(newFileKey, file);
          record.fileKey = newFileKey;
          record.fileName = file.name;
          record = validateRecord(collection, record);
        }
      }
      const next = clone(state.data);
      const index = next[collection].findIndex(item => item.id === id);
      if (index >= 0) next[collection][index] = record;
      else next[collection].unshift(record);
      commit(next, `${id ? 'Updated' : 'Added'} ${ENTITY[collection].label}: ${recordTitle(record)}.`);
      committed = true;
      if (previous?.fileKey && previous.fileKey !== record.fileKey) await removeFile(previous.fileKey);
      state.busy = false;
      state.formModal.hide();
      render();
      toast(`${capitalize(ENTITY[collection].label)} saved.`);
    } catch (error) {
      if (newFileKey && !committed) await removeFile(newFileKey);
      showFormError(error.message || 'The record could not be saved. Please try again.');
    } finally {
      state.busy = false;
      $('formSave').disabled = false;
      $('formSave').textContent = 'Save record';
    }
  }

  // ========================================================================
  // EVENTS — stable delegated containers, command keys, and mutation handlers.
  // ========================================================================
  async function deleteRecord(collection, id) {
    enforce('manage');
    const record = getRecord(collection, id);
    if (!record) throw new Error('This record no longer exists.');
    if (collection === 'clients') {
      const hasLinkedRecords = ['documents', 'transactions', 'compliance', 'invoices'].some(key => state.data[key].some(item => item.clientId === id));
      if (hasLinkedRecords) throw new Error('This client has linked records. Archive the client to preserve its history, or remove linked records before deleting it.');
    }
    const accepted = await askConfirmation(`Delete ${ENTITY[collection].label}?`,
      `“${recordTitle(record)}” will be removed from this workspace${record.fileKey ? ', including its attachment' : ''}. This cannot be undone.`, 'Delete record');
    if (!accepted) return;
    enforce('manage');
    const next = clone(state.data);
    next[collection] = next[collection].filter(item => item.id !== id);
    commit(next, `Deleted ${ENTITY[collection].label}: ${recordTitle(record)}.`);
    if (record.fileKey) await removeFile(record.fileKey);
    render();
    toast(`${capitalize(ENTITY[collection].label)} deleted.`);
  }

  async function archiveClient(id) {
    enforce('manage');
    const client = getRecord('clients', id);
    if (!client) throw new Error('This client no longer exists.');
    const archive = client.status === 'Active';
    if (archive && !await askConfirmation('Archive client?', `Move ${client.name} to archived clients? Existing records and deadlines will remain available.`, 'Archive client')) return;
    enforce('manage');
    const next = clone(state.data);
    next.clients.find(item => item.id === id).status = archive ? 'Archived' : 'Active';
    commit(next, `${archive ? 'Archived' : 'Restored'} client: ${client.name}.`);
    render();
    toast(archive ? 'Client archived.' : 'Client restored.');
  }

  function changeRecordStatus(collection, id) {
    if (collection === 'invoices') enforce('billing');
    const next = clone(state.data);
    const record = next[collection].find(item => item.id === id);
    if (!record) throw new Error('This record no longer exists.');
    if (collection === 'invoices') {
      record.status = 'Paid';
      commit(next, `Marked invoice ${record.id} as paid.`);
      toast('Invoice marked as paid.');
    } else {
      record.status = record.status === 'Filed' ? 'Pending' : 'Filed';
      record.filedDate = record.status === 'Filed' ? localISO() : '';
      commit(next, `${record.status === 'Filed' ? 'Filed' : 'Reopened'} ${record.requirement}.`);
      toast(record.status === 'Filed' ? 'Deadline marked as filed.' : 'Deadline reopened.');
    }
    render();
  }

  function logOnly(message) {
    try { commit(state.data, message); }
    catch (error) { toast('The action completed, but its activity entry could not be saved.', true); }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function exportJSON() {
    logOnly('Exported workspace JSON backup.');
    downloadBlob(new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' }), `veritas-core-backup-${localISO()}.json`);
    render();
    toast('Workspace backup exported. Attachments remain in this browser.');
  }

  function csvCell(value) {
    // Prevent spreadsheet formula execution in exported user-entered fields.
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    const fields = ['id', 'name', 'type', 'contact', 'email', 'phone', 'tin', 'cbl', 'cor', 'status'];
    const rows = [fields.map(capitalize), ...state.data.clients.map(client => fields.map(key => client[key]))];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `veritas-core-clients-${localISO()}.csv`);
    logOnly('Exported client directory as CSV.');
    render();
    toast('Client directory exported.');
  }

  async function importJSON(file) {
    enforce('import');
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a JSON backup smaller than 10 MB.');
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (error) { throw new Error('This file is not valid JSON. Choose a Veritas Core workspace backup.'); }
    const data = parsed?.meta?.version === 1 ? migrateData(parsed) : validateData(parsed);
    const count = COLLECTIONS.reduce((total, collection) => total + data[collection].length, 0);
    if (!await askConfirmation('Replace workspace records?', `Import ${count} records from “${file.name}”? Current records will be replaced. Export a backup first if you need to keep them. Attachments are not included in JSON backups.`, 'Replace records')) return;
    enforce('import');
    commit(data, `Imported ${count} workspace records from JSON.`, true);
    state.readNotifications.clear();
    saveSession();
    resetFilters();
    render();
    toast('Workspace records restored.');
  }

  async function resetWorkspace() {
    enforce('reset');
    if (!await askConfirmation('Reset this workspace?', 'All current workspace records and locally stored attachments will be removed. This cannot be undone. Keep a JSON backup and original attachments before continuing.', 'Reset workspace')) return;
    enforce('reset');
    const next = { meta: { version: VERSION, firm: 'RBCIA Accounting Firm', lastSaved: new Date().toISOString() }, activity: [] };
    COLLECTIONS.forEach(collection => { next[collection] = []; });
    commit(next, 'Workspace reset. Ready for new records.', true);
    await state.fileReady;
    if (state.fileDB) {
      try { await fileRequest(state.fileDB, 'readwrite', store => store.clear()); }
      catch (error) { addWarning('Workspace records were reset, but some attachments could not be cleared from browser storage.'); }
    } else addWarning('Workspace records were reset. File storage is unavailable, so attachment removal could not be verified.');
    state.readNotifications.clear();
    saveSession();
    resetFilters();
    render();
    toast('Workspace reset.');
  }

  async function dispatchAction(data) {
    const { action, collection, id } = data;
    const permission = actionPermission(action === 'detail-edit' ? 'edit' : action, collection);
    if (permission) enforce(permission);
    switch (action) {
      case 'navigate': return navigate(data.view);
      case 'new': return openRecordForm(collection);
      case 'edit': return openRecordForm(collection, id);
      case 'detail': return openRecordDetail(collection, id);
      case 'detail-edit': return detailToEdit(collection, id);
      case 'delete': return deleteRecord(collection, id);
      case 'archive': return archiveClient(id);
      case 'download': return downloadFile(id);
      case 'filed': return changeRecordStatus('compliance', id);
      case 'mark-paid': return changeRecordStatus('invoices', id);
      case 'export-json': return exportJSON();
      case 'export-csv': return exportCSV();
      case 'import': $('importInput').click(); return;
      case 'reset': return resetWorkspace();
      case 'print': window.print(); return;
      case 'clear-filters': searchInput.cancel(); resetFilters(); render(); $('listSearch')?.focus(); return;
      case 'category': state.kbCategory = data.category; render(); return;
      case 'sort': {
        const previous = state.sort[state.view];
        state.sort[state.view] = { key: data.key, direction: previous?.key === data.key && previous.direction === 'asc' ? 'desc' : 'asc' };
        render();
        [...$('viewRoot').querySelectorAll('[data-action="sort"]')].find(button => button.dataset.key === data.key)?.focus();
        return;
      }
      case 'confirm-accept': finishConfirmation(true); return;
      case 'confirm-cancel': finishConfirmation(false); return;
      case 'notification-detail':
        state.readNotifications.add(data.key);
        saveSession();
        closeNotifications();
        renderNotifications();
        return openRecordDetail(collection, id);
      case 'read-notifications':
        computeNotifications().forEach(item => state.readNotifications.add(item.key));
        saveSession();
        renderNotifications();
        toast('Notifications marked as read.');
        return;
      default: return;
    }
  }

  async function handleAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    event.preventDefault();
    if (target.dataset.action === 'dismiss-toast') { target.closest('.app-toast').remove(); return; }
    try { await dispatchAction(target.dataset); }
    catch (error) { toast(error.message || 'The action could not be completed.', true); }
  }

  const searchInput = debounce(value => {
    state.query = value;
    render({ keepFocus: true });
  });

  function setSidebar(open) {
    state.sidebarOpen = open;
    $('sidebar').classList.toggle('is-open', open);
    $('sidebarOverlay').hidden = !open;
    $('sidebarToggle').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('nav-open', open);
    $('mainArea').inert = open;
    if (open) {
      $('sidebar').setAttribute('role', 'dialog');
      $('sidebar').setAttribute('aria-modal', 'true');
      document.querySelector('#mainNav .active').focus();
    } else {
      $('sidebar').removeAttribute('role');
      $('sidebar').removeAttribute('aria-modal');
    }
  }

  function closeSidebar() {
    setSidebar(false);
    $('sidebarToggle').focus();
  }

  function onKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (state.cmdk.open) closeCommand(); else openCommand();
      return;
    }
    if (state.cmdk.open && event.target === $('commandInput') && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter') {
        chooseCommand(state.cmdk.index).catch(error => toast(error.message, true));
      } else {
        const length = state.cmdk.results.length;
        if (length) state.cmdk.index = (state.cmdk.index + (event.key === 'ArrowDown' ? 1 : -1) + length) % length;
        updateCommandSelection();
      }
      return;
    }
    if (event.key === 'Escape') {
      if (state.cmdk.open) { event.preventDefault(); closeCommand(); }
      else if (state.sidebarOpen) closeSidebar();
      else if (!$('notificationPanel').hidden) { closeNotifications(); $('notificationTrigger').focus(); }
    }
    if (event.key === 'Tab' && state.sidebarOpen) {
      const controls = [...$('sidebar').querySelectorAll('a[href],button:not(:disabled)')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  function bindViewEvents() {
    // Called once at initialization. All rendered controls use these parents.
    $('viewRoot').addEventListener('click', handleAction);
    $('viewRoot').addEventListener('input', event => {
      if (event.target.dataset.filter === 'query') searchInput(event.target.value);
    });
    $('viewRoot').addEventListener('change', event => {
      const key = event.target.dataset.filter;
      if (!key || key === 'query') return;
      searchInput.cancel();
      state.query = $('listSearch')?.value || '';
      state.filters[key] = event.target.value;
      render({ keepFocus: true });
    });
    $('viewRoot').addEventListener('submit', event => {
      if (event.target.id !== 'settingsForm') return;
      event.preventDefault();
      const name = $('settingName').value.trim();
      const role = $('settingRole').value;
      if (!name || !Object.hasOwn(ROLES, role)) return;
      state.user = name;
      state.role = role;
      saveSession();
      logOnly(`Updated workspace preferences. Access role: ${role}.`);
      render();
      toast('Workspace preferences saved.');
    });
  }

  function bindEvents() {
    bindViewEvents();
    $('sidebar').addEventListener('click', handleAction);
    $('detailModal').addEventListener('click', handleAction);
    $('notificationPanel').addEventListener('click', handleAction);
    $('toastStack').addEventListener('click', handleAction);
    $('recordForm').addEventListener('submit', saveRecord);
    $('sidebarToggle').addEventListener('click', () => setSidebar(!state.sidebarOpen));
    $('sidebarClose').addEventListener('click', closeSidebar);
    $('sidebarOverlay').addEventListener('click', closeSidebar);
    $('profileTrigger').addEventListener('click', () => navigate('workspace'));
    $('commandTrigger').addEventListener('click', openCommand);
    $('commandClose').addEventListener('click', closeCommand);
    $('commandInput').addEventListener('input', event => {
      state.cmdk.query = event.target.value;
      state.cmdk.index = 0;
      renderCommand();
    });
    $('commandResults').addEventListener('click', event => {
      const result = event.target.closest('[data-command-index]');
      if (result) chooseCommand(Number(result.dataset.commandIndex)).catch(error => toast(error.message, true));
    });
    $('commandPalette').addEventListener('cancel', event => { event.preventDefault(); closeCommand(); });
    $('commandPalette').addEventListener('click', event => {
      if (event.target !== $('commandPalette')) return;
      const rect = $('commandPalette').getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeCommand();
    });
    $('notificationTrigger').addEventListener('click', () => {
      const open = $('notificationPanel').hidden;
      $('notificationPanel').hidden = !open;
      $('notificationTrigger').setAttribute('aria-expanded', String(open));
      if (open) $('notificationPanel').querySelector('button')?.focus();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.notification-wrap')) closeNotifications();
    });
    document.addEventListener('keydown', onKeydown);
    $('importInput').addEventListener('change', async event => {
      const file = event.target.files[0];
      event.target.value = '';
      try { await importJSON(file); }
      catch (error) { toast(error.message || 'This backup could not be imported.', true); }
    });
    $('formModal').addEventListener('shown.bs.modal', () => $('formModalBody').querySelector('input,select,textarea')?.focus());
    $('formModal').addEventListener('hide.bs.modal', event => { if (state.busy) event.preventDefault(); });
    $('formModal').addEventListener('hidden.bs.modal', () => { state.form = null; restoreFocus(); });
    $('detailModal').addEventListener('shown.bs.modal', () => {
      if (state.confirmResolve) $('detailModalFooter').querySelector('[data-action="confirm-cancel"]')?.focus();
    });
    $('detailModal').addEventListener('hidden.bs.modal', () => {
      if (state.confirmResolve) { state.confirmResolve(false); state.confirmResolve = null; }
      state.detailRecord = null;
      restoreFocus();
    });
    window.matchMedia('(min-width: 992px)').addEventListener('change', event => { if (event.matches) setSidebar(false); });
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY) addWarning('Workspace data changed in another tab. Export unsaved work and reload before editing further.');
    });
    window.addEventListener('focus', () => {
      if (!$('formModal').classList.contains('show') && !$('detailModal').classList.contains('show')) render({ keepFocus: true });
    });
  }

  // ========================================================================
  // INIT — show a useful error if required CDN resources could not be loaded.
  // ========================================================================
  function init() {
    if (!window.bootstrap?.Modal) {
      $('loadError').textContent = 'The interface library could not load. Connect to the internet and reload this page.';
      return;
    }
    try {
      state.data = loadData();
      loadSession();
      state.formModal = new bootstrap.Modal($('formModal'), { backdrop: 'static' });
      state.detailModal = new bootstrap.Modal($('detailModal'));
      state.fileReady = initIndexedDB();
      bindEvents();
      render();
      $('loadError').hidden = true;
      const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
      $('commandTrigger').querySelector('kbd').textContent = shortcut;
    } catch (error) {
      $('loadError').textContent = 'The workspace could not start. Your saved records have not been removed. Reload the page or try another modern browser.';
    }
  }

  init();
})();
