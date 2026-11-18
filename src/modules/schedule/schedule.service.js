'use strict';
const prisma = require('../../database/prisma');
const { notFound, badRequest, unprocessable } = require('../../utils/errors');
const { toDbDate, fromDbDate } = require('../../utils/dates');
const { expandDates, expandSubject, detectConflicts } = require('./schedule.logic');
const activity = require('../../services/activity.service');

const PALETTE = ['#2563EB', '#0891B2', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#0EA5E9', '#64748B', '#CA8A04'];

const SUBJECT_INCLUDE = {
  periods: { orderBy: [{ orderIndex: 'asc' }, { startDate: 'asc' }], include: { sessions: { orderBy: [{ dayOfWeek: 'asc' }, { startPeriod: 'asc' }] } } },
  semester: { select: { id: true, name: true } },
  _count: { select: { meetings: true, tasks: true, files: true, notes: true } },
};

// ---------------------------------------------------------------- Serialize
function serializeSubject(s) {
  return {
    ...s,
    periods: (s.periods || []).map((p) => ({
      ...p,
      startDate: fromDbDate(p.startDate),
      endDate: fromDbDate(p.endDate),
    })),
  };
}

function serializeSemester(s) {
  return { ...s, startDate: fromDbDate(s.startDate), endDate: fromDbDate(s.endDate) };
}

// ---------------------------------------------------------------- Semesters
async function listSemesters(userId) {
  const rows = await prisma.semester.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
    include: { _count: { select: { subjects: { where: { deletedAt: null } } } } },
  });
  return rows.map(serializeSemester);
}

async function ownSemester(userId, id, tx = prisma) {
  const s = await tx.semester.findFirst({ where: { id, userId, deletedAt: null } });
  if (!s) throw notFound('Không tìm thấy học kỳ');
  return s;
}

function semesterData(d) {
  const out = { ...d };
  if ('startDate' in d) out.startDate = toDbDate(d.startDate);
  if ('endDate' in d) out.endDate = toDbDate(d.endDate);
  return out;
}

async function createSemester(userId, data, tx = prisma) {
  if (data.isCurrent) await tx.semester.updateMany({ where: { userId }, data: { isCurrent: false } });
  const s = await tx.semester.create({ data: { ...semesterData(data), userId } });
  return serializeSemester(s);
}

async function updateSemester(userId, id, data) {
  await ownSemester(userId, id);
  return prisma.$transaction(async (tx) => {
    if (data.isCurrent) await tx.semester.updateMany({ where: { userId, NOT: { id } }, data: { isCurrent: false } });
    return serializeSemester(await tx.semester.update({ where: { id }, data: semesterData(data) }));
  });
}

async function deleteSemester(userId, id) {
  await ownSemester(userId, id);
  const now = new Date();
  await prisma.$transaction([
    prisma.semester.update({ where: { id }, data: { deletedAt: now, isCurrent: false } }),
    prisma.subject.updateMany({ where: { semesterId: id, userId, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  await activity.log(userId, 'schedule.semester_delete', 'Xóa học kỳ (có thể khôi phục trong Thùng rác)', { entityType: 'SEMESTER', entityId: id });
}

// ---------------------------------------------------------------- Subjects
async function listSubjects(userId, { semesterId } = {}) {
  const rows = await prisma.subject.findMany({
    where: { userId, deletedAt: null, ...(semesterId ? { semesterId } : {}) },
    orderBy: [{ createdAt: 'asc' }],
    include: SUBJECT_INCLUDE,
  });
  return rows.map(serializeSubject);
}

/** Danh sách rút gọn để chọn môn ở các module khác (Drive/Note/Task...). */
async function subjectOptions(userId) {
  return prisma.subject.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, name: true, code: true, color: true, semesterId: true },
    orderBy: { name: 'asc' },
  });
}

async function ownSubject(userId, id, tx = prisma) {
  const s = await tx.subject.findFirst({ where: { id, userId, deletedAt: null } });
  if (!s) throw notFound('Không tìm thấy môn học');
  return s;
}

async function getSubject(userId, id) {
  await ownSubject(userId, id);
  return serializeSubject(await prisma.subject.findUnique({ where: { id }, include: SUBJECT_INCLUDE }));
}

/** Tạo periods + sessions + meetings (buổi học cụ thể) cho 1 môn trong transaction. */
async function writeSchedule(tx, userId, subjectId, periods) {
  let meetingCount = 0;
  for (const [pi, p] of periods.entries()) {
    const period = await tx.schedulePeriod.create({
      data: { subjectId, startDate: toDbDate(p.startDate), endDate: toDbDate(p.endDate), rawText: p.rawText ?? null, orderIndex: pi },
    });
    const seenDates = new Set();
    for (const s of p.sessions) {
      const session = await tx.classSession.create({
        data: {
          periodId: period.id,
          dayOfWeek: s.dayOfWeek,
          startPeriod: s.startPeriod,
          endPeriod: s.endPeriod,
          periods: s.periods || rangeText(s.startPeriod, s.endPeriod),
          room: s.room ?? null,
          location: s.location ?? null,
          lecturer: s.lecturer ?? null,
        },
      });
      let dates;
      try {
        dates = expandDates(p.startDate, p.endDate, s.dayOfWeek);
      } catch (e) {
        throw unprocessable(e.message);
      }
      // Bỏ buổi trùng hoàn toàn trong cùng khoảng ngày (cùng ngày + tiết + phòng)
      dates = dates.filter((d) => {
        const k = `${d}|${s.startPeriod}|${s.endPeriod}|${s.room || ''}`;
        if (seenDates.has(k)) return false;
        seenDates.add(k);
        return true;
      });
      if (dates.length) {
        await tx.classMeeting.createMany({
          data: dates.map((d) => ({
            userId,
            subjectId,
            sessionId: session.id,
            date: toDbDate(d),
            startPeriod: s.startPeriod,
            endPeriod: s.endPeriod,
            room: s.room ?? null,
          })),
          skipDuplicates: true,
        });
        meetingCount += dates.length;
      }
    }
  }
  return meetingCount;
}

function rangeText(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i).join(',');
}

async function createSubject(userId, data) {
  const { periods, semesterId, ...fields } = data;
  if (semesterId) await ownSemester(userId, semesterId);
  const count = await prisma.subject.count({ where: { userId } });
  const subject = await prisma.$transaction(async (tx) => {
    const s = await tx.subject.create({
      data: { ...fields, color: fields.color || PALETTE[count % PALETTE.length], semesterId: semesterId ?? null, userId },
    });
    await writeSchedule(tx, userId, s.id, periods);
    return s;
  });
  await activity.log(userId, 'schedule.subject_create', `Thêm môn học "${subject.name}"`, { entityType: 'SUBJECT', entityId: subject.id });
  return getSubject(userId, subject.id);
}

async function updateSubject(userId, id, data, { replacePeriods }) {
  await ownSubject(userId, id);
  const { periods, semesterId, ...fields } = data;
  if (semesterId) await ownSemester(userId, semesterId);
  await prisma.$transaction(async (tx) => {
    await tx.subject.update({ where: { id }, data: { ...fields, ...(semesterId !== undefined ? { semesterId } : {}) } });
    if (replacePeriods) {
      await tx.schedulePeriod.deleteMany({ where: { subjectId: id } }); // cascade: sessions + meetings
      await writeSchedule(tx, userId, id, periods);
    }
  });
  return getSubject(userId, id);
}

async function deleteSubject(userId, id) {
  const s = await ownSubject(userId, id);
  await prisma.subject.update({ where: { id }, data: { deletedAt: new Date() } });
  await activity.log(userId, 'schedule.subject_delete', `Xóa môn học "${s.name}"`, { entityType: 'SUBJECT', entityId: id });
}

// ---------------------------------------------------------------- Meetings
async function listMeetings(userId, { from, to, semesterId, subjectId }) {
  const rows = await prisma.classMeeting.findMany({
    where: {
      userId,
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      subject: { deletedAt: null, ...(semesterId ? { semesterId } : {}), ...(subjectId ? { id: subjectId } : {}) },
    },
    orderBy: [{ date: 'asc' }, { startPeriod: 'asc' }],
    include: {
      subject: { select: { id: true, name: true, code: true, color: true, classCode: true, lecturer: true } },
      session: { select: { periods: true, location: true, lecturer: true } },
      _count: { select: { tasks: { where: { deletedAt: null } } } },
    },
  });
  return rows.map((m) => ({ ...m, date: fromDbDate(m.date) }));
}

async function getMeeting(userId, id) {
  const m = await prisma.classMeeting.findFirst({
    where: { id, userId, subject: { deletedAt: null } },
    include: {
      subject: { select: { id: true, name: true, code: true, color: true, classCode: true, lecturer: true, credits: true } },
      session: { include: { period: { select: { startDate: true, endDate: true, rawText: true } } } },
      tasks: { where: { deletedAt: null }, select: { id: true, title: true, status: true, dueAt: true, priority: true } },
    },
  });
  if (!m) throw notFound('Không tìm thấy buổi học');
  return {
    ...m,
    date: fromDbDate(m.date),
    session: { ...m.session, period: { ...m.session.period, startDate: fromDbDate(m.session.period.startDate), endDate: fromDbDate(m.session.period.endDate) } },
  };
}

async function updateMeeting(userId, id, data) {
  await getMeeting(userId, id);
  await prisma.classMeeting.update({ where: { id }, data });
  return getMeeting(userId, id);
}

async function conflicts(userId, { from, to, semesterId }) {
  const meetings = await listMeetings(userId, { from, to, semesterId });
  return detectConflicts(
    meetings.map((m) => ({
      id: m.id,
      subjectKey: m.subjectId,
      subjectName: m.subject.name,
      date: m.date,
      startPeriod: m.startPeriod,
      endPeriod: m.endPeriod,
      room: m.room,
      status: m.status,
      source: 'existing',
    }))
  );
}

// ---------------------------------------------------------------- Import
/** Tạo dữ liệu xem trước: số buổi học từng môn + xung đột (trong file và với lịch đã có). */
async function buildPreview(userId, parsed) {
  const allNew = [];
  const subjects = parsed.subjects.map((s) => {
    const { meetings, duplicates } = expandSubject(s);
    allNew.push(...meetings.map((m) => ({ ...m, source: 'new' })));
    const warnings = [...s.warnings];
    if (duplicates.length) warnings.push(`Bỏ ${duplicates.length} buổi học trùng lặp trong dữ liệu file`);
    return { ...s, warnings, meetingCount: meetings.length, firstDate: meetings[0]?.date ?? null, lastDate: meetings.at(-1)?.date ?? null };
  });
  const dates = allNew.map((m) => m.date).sort();
  let existing = [];
  if (dates.length) {
    existing = (await listMeetings(userId, { from: dates[0], to: dates.at(-1) })).map((m) => ({
      id: m.id,
      subjectKey: `db-${m.subjectId}`,
      subjectName: m.subject.name,
      date: m.date,
      startPeriod: m.startPeriod,
      endPeriod: m.endPeriod,
      room: m.room,
      status: m.status,
      source: 'existing',
    }));
  }
  const conflictList = detectConflicts([...allNew, ...existing]).filter((c) => c.a.source === 'new' || c.b.source === 'new');
  return {
    subjects,
    conflicts: conflictList,
    stats: {
      subjectCount: subjects.length,
      totalCredits: subjects.reduce((a, s) => a + (s.credits || 0), 0),
      meetingCount: allNew.length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      existingConflicts: conflictList.filter((c) => c.a.source === 'existing' || c.b.source === 'existing').length,
    },
  };
}

async function previewImport(userId, parsed, fileName) {
  if (parsed.errors.length) {
    throw unprocessable(parsed.errors.join(' '), { code: 'IMPORT_PARSE', details: parsed.errors.map((e) => ({ field: 'file', message: e })) });
  }
  const preview = await buildPreview(userId, parsed);
  const data = { ...parsed, ...preview };
  const rec = await prisma.scheduleImport.create({
    data: { userId, adapter: parsed.adapter, fileName: fileName.slice(0, 255), previewData: data },
  });
  return { importId: rec.id, ...data };
}

/** Xem trước lại sau khi người dùng chỉnh sửa (không lưu dữ liệu chính thức). */
async function revalidateImport(userId, importId, subjects) {
  const rec = await prisma.scheduleImport.findFirst({ where: { id: importId, userId, status: 'PREVIEW' } });
  if (!rec) throw notFound('Phiên import không tồn tại hoặc đã kết thúc');
  const parsed = { subjects: subjects.filter((s) => s.include !== false).map((s, i) => ({ key: s.key || `s${i + 1}`, warnings: [], ...s })) };
  return buildPreview(userId, parsed);
}

async function confirmImport(userId, importId, body) {
  const rec = await prisma.scheduleImport.findFirst({ where: { id: importId, userId } });
  if (!rec) throw notFound('Phiên import không tồn tại');
  if (rec.status !== 'PREVIEW') throw badRequest('Phiên import này đã được xử lý');

  const subjects = body.subjects.filter((s) => s.include);
  if (!subjects.length) throw badRequest('Hãy chọn ít nhất một môn học để nhập');
  if (!body.semesterId && !body.newSemester) throw badRequest('Hãy chọn hoặc tạo học kỳ');

  const result = await prisma.$transaction(
    async (tx) => {
      let semesterId = body.semesterId;
      if (semesterId) await ownSemester(userId, semesterId, tx);
      else semesterId = (await createSemester(userId, body.newSemester, tx)).id;

      const existing = await tx.subject.findMany({ where: { userId, semesterId, deletedAt: null }, select: { id: true, code: true, classCode: true, name: true } });
      const sameAs = (s) => existing.find((e) => (s.code ? e.code === s.code : e.name === s.name) && (e.classCode || '') === (s.classCode || ''));

      const baseCount = await tx.subject.count({ where: { userId } });
      let created = 0;
      let skipped = 0;
      let replaced = 0;
      let meetings = 0;
      for (const [i, s] of subjects.entries()) {
        const dup = sameAs(s);
        if (dup && body.duplicateMode === 'skip') {
          skipped++;
          continue;
        }
        if (dup) {
          await tx.subject.update({ where: { id: dup.id }, data: { deletedAt: new Date() } });
          replaced++;
        }
        const { periods, include, key, ...fields } = s;
        const subject = await tx.subject.create({
          data: { ...fields, color: fields.color || PALETTE[(baseCount + i) % PALETTE.length], userId, semesterId, importId },
        });
        meetings += await writeSchedule(tx, userId, subject.id, periods);
        created++;
      }

      await tx.scheduleImport.update({ where: { id: importId }, data: { status: 'CONFIRMED', confirmedAt: new Date(), semesterId } });

      if (body.applyProfile) {
        const st = rec.previewData?.meta?.student || {};
        const profile = {};
        if (st.className) profile.className = String(st.className).slice(0, 60);
        if (st.major) profile.major = String(st.major).slice(0, 191);
        if (st.studentCode) profile.studentCode = String(st.studentCode).slice(0, 40);
        if (Object.keys(profile).length) await tx.user.update({ where: { id: userId }, data: profile });
      }
      return { semesterId, created, skipped, replaced, meetings };
    },
    { timeout: 30000 }
  );
  await activity.log(userId, 'schedule.import', `Nhập thời khóa biểu: ${result.created} môn, ${result.meetings} buổi học`, {
    entityType: 'SEMESTER',
    entityId: result.semesterId,
    metadata: { adapter: rec.adapter, ...result },
  });
  return result;
}

async function cancelImport(userId, importId) {
  const rec = await prisma.scheduleImport.findFirst({ where: { id: importId, userId, status: 'PREVIEW' } });
  if (!rec) throw notFound('Phiên import không tồn tại');
  await prisma.scheduleImport.update({ where: { id: importId }, data: { status: 'CANCELLED', previewData: {} } });
}

async function listImports(userId) {
  return prisma.scheduleImport.findMany({
    where: { userId, status: 'CONFIRMED' },
    select: { id: true, adapter: true, fileName: true, confirmedAt: true, semester: { select: { id: true, name: true } }, _count: { select: { subjects: true } } },
    orderBy: { confirmedAt: 'desc' },
    take: 20,
  });
}

module.exports = {
  PALETTE,
  listSemesters,
  createSemester,
  updateSemester,
  deleteSemester,
  listSubjects,
  subjectOptions,
  getSubject,
  createSubject,
  updateSubject,
  deleteSubject,
  listMeetings,
  getMeeting,
  updateMeeting,
  conflicts,
  previewImport,
  revalidateImport,
  confirmImport,
  cancelImport,
  listImports,
};
