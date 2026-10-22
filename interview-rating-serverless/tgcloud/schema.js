import { table, integer, text, index, uniqueIndex } from 'sdk/db';

// Кандидаты. id — короткий код из ссылки t.me/<бот>/<app>?startapp=<id>.
export const candidates = table('candidates', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  position:         text('position').notNull().default(''),
  createdBy:        integer('created_by'),
  createdAt:        integer('created_at').notNull(),
  // Резюме хранится в Telegram: здесь только file_id и сведения о файле.
  resumeFileId:     text('resume_file_id'),
  resumeFileName:   text('resume_file_name'),
  resumeSize:       integer('resume_size'),
  resumeUploadedBy: text('resume_uploaded_by'),
  resumeUploadedAt: integer('resume_uploaded_at'),
});

// Оценки: одна на пару «кандидат — участник», повторная оценка заменяет прежнюю.
export const votes = table('votes', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  candidateId: text('candidate_id').notNull(),
  userId:      integer('user_id').notNull(),
  name:        text('name').notNull(),
  username:    text('username'),
  score:       integer('score').notNull(),
  decision:    text('decision').notNull(),
  comment:     text('comment').notNull().default(''),
  createdAt:   integer('created_at').notNull(),
  updatedAt:   integer('updated_at').notNull(),
}, (t) => ({
  uniqVote:     uniqueIndex('uidx_votes_candidate_user').on(t.candidateId, t.userId),
  byCandidate:  index('idx_votes_candidate').on(t.candidateId),
}));
