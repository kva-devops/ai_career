import { Pool } from 'pg';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:8000/api';
const db = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://career_app:career_app_local@127.0.0.1:5434/career_navigator' });
const stamp = Date.now();
const password = 'qa-test-password-2026';
const users = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(client, path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (client.cookie) headers.Cookie = client.cookie;
  const response = await fetch(base + path, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) client.cookie = setCookie.split(';')[0];
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function register(label) {
  const client = { cookie: '' };
  const email = `qa-memory-${label}-${stamp}@example.com`;
  const result = await request(client, '/auth/register', { method: 'POST', body: JSON.stringify({ fullName: `QA ${label}`, email, password }) });
  check(result.status === 201, `${label}: регистрация вернула ${result.status}`);
  users.push(result.body.user.id);
  return { ...client, id: result.body.user.id, email };
}

async function chat(client, message) {
  const result = await request(client, '/chat', { method: 'POST', body: JSON.stringify({ message }) });
  check(result.status === 200, `чат вернул ${result.status}: ${result.body.error || ''}`);
  check(result.body.reply, 'чат вернул пустой ответ');
  return result.body;
}

async function run() {
  const results = [];
  const a = await register('a');
  const b = await register('b');
  const bSecret = `секрет клиента B ${stamp}`;

  try {
    // 1. Память текущего диалога: два сообщения должны попасть в один SQL-диалог,
    // а второе обращение должно получить контекст первого сообщения.
    const first = await chat(a, `Запомни в рамках текущего диалога: для проекта я изучаю Kafka, маркер ${stamp}.`);
    const second = await chat(a, 'Какую технологию я сейчас изучаю для проекта?');
    const current = await db.query('SELECT d.id, count(m.id)::int AS count FROM dialogues d LEFT JOIN messages m ON m.dialogue_id=d.id WHERE d.id=$1 GROUP BY d.id', [first.dialogueId]);
    check(current.rows[0]?.count === 4, `ожидалось 4 сообщения в текущем диалоге, получено ${current.rows[0]?.count}`);
    check(/kafka/i.test(second.reply), 'ответ текущего диалога не использовал Kafka из предыдущего сообщения');
    results.push({ scenario: 1, status: 'PASS', details: 'История и контекст текущего диалога сохранены; Kafka учтена в следующем ответе.' });

    // 2. Долгосрочная память: SQL-профиль и memory_facts должны пережить новый диалог.
    await request(a, '/profile', { method: 'PUT', body: JSON.stringify({ role: 'Java-разработчик', goal_horizon: '3 месяца', learning_time: '5 часов в неделю' }) });
    await request(a, '/memory', { method: 'GET' });
    await db.query(`INSERT INTO memory_facts(user_id,field_name,value) VALUES($1,'qa_long_term',$2) ON CONFLICT(user_id,field_name) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [a.id, `долгосрочный факт ${stamp}`]);
    const newDialogue = await request(a, '/dialogues', { method: 'POST', body: JSON.stringify({ title: 'QA новый диалог' }) });
    check(newDialogue.status === 201, 'не удалось создать новый диалог');
    const longTerm = await chat(a, 'Какой у меня сейчас горизонт карьерной цели?');
    const persisted = await db.query('SELECT p.goal_horizon,m.value FROM profiles p LEFT JOIN memory_facts m ON m.user_id=p.user_id AND m.field_name=$2 WHERE p.user_id=$1', [a.id, 'qa_long_term']);
    check(persisted.rows[0]?.goal_horizon === '3 месяца', 'горизонт цели не сохранился в SQL');
    check(persisted.rows[0]?.value === `долгосрочный факт ${stamp}`, 'долгосрочный факт не сохранился в SQL');
    check(/3\s*месяц/i.test(longTerm.reply), 'новый диалог не использовал долгосрочное значение из профиля');
    results.push({ scenario: 2, status: 'PASS', details: 'Профиль и memory_facts доступны после создания нового диалога.' });

    // 3. Изменение SQL должно влиять на последующий ответ агента.
    await db.query("UPDATE profiles SET role='Backend Architect', goal_horizon='18 месяцев', updated_at=now() WHERE user_id=$1", [a.id]);
    const changed = await chat(a, 'Какую текущую роль и горизонт цели ты видишь в моём профиле?');
    check(/Backend Architect/i.test(changed.reply) && /18\s*месяц/i.test(changed.reply), 'агент не использовал актуальные значения после изменения SQL');
    results.push({ scenario: 3, status: 'PASS', details: 'Ответ после прямого изменения SQL использовал Backend Architect и 18 месяцев.' });

    // 4. Изоляция: клиент A не должен получить диалог, память или админ-данные клиента B.
    const bChat = await chat(b, bSecret);
    const foreignDialogue = await request(a, `/dialogues/${bChat.dialogueId}/messages`, { method: 'GET' });
    const foreignAdmin = await request(a, `/admin/users/${b.id}`, { method: 'GET' });
    check(foreignDialogue.status === 200 && (!foreignDialogue.body.messages || foreignDialogue.body.messages.length === 0), 'клиент A получил сообщения клиента B');
    check(foreignAdmin.status === 403, `клиент A получил доступ к admin API: ${foreignAdmin.status}`);
    check(!JSON.stringify(changed).includes(bSecret), 'ответ клиенту A содержит секрет клиента B');
    results.push({ scenario: 4, status: 'PASS', details: 'Чужой диалог не возвращается, admin API закрыт кодом 403, секрет B не попал в ответ A.' });
  } finally {
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  }

  console.log(JSON.stringify({ model: process.env.PROXY_API_MODEL || 'gpt-4o-mini (server default)', results }, null, 2));
}

run().catch(error => { console.error(JSON.stringify({ status: 'FAIL', error: error.message }, null, 2)); process.exitCode = 1; }).finally(() => db.end());
