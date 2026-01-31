-- Sample data matching SQLite test fixtures
CREATE TABLE IF NOT EXISTS authors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS books (
    id SERIAL PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES authors(id),
    title TEXT NOT NULL,
    isbn TEXT UNIQUE
);

-- Partitioned tables (same-schema and cross-schema)
CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL,
    happened_on DATE NOT NULL,
    payload TEXT,
    PRIMARY KEY (id, happened_on)
) PARTITION BY RANGE (happened_on);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'events_2024'
            AND n.nspname = 'public'
    ) THEN
        CREATE TABLE events_2024 PARTITION OF events
            FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'events_2025'
            AND n.nspname = 'archive'
    ) THEN
        CREATE TABLE archive.events_2025 PARTITION OF events
            FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS composite_pk (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    value TEXT,
    CONSTRAINT composite_pk_pkey PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS composite_parent (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    value TEXT,
    CONSTRAINT composite_parent_pkey PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS composite_child (
    a INTEGER,
    b INTEGER,
    note TEXT,
    CONSTRAINT composite_child_fk
        FOREIGN KEY (a, b)
        REFERENCES composite_parent(a, b)
        MATCH FULL
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS checked (
    id SERIAL PRIMARY KEY,
    rating INTEGER,
    CONSTRAINT checked_rating_chk CHECK (rating >= 0)
);

CREATE TABLE IF NOT EXISTS publishers (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    CONSTRAINT publishers_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS books_audit (
    id SERIAL PRIMARY KEY,
    book_id INTEGER NOT NULL,
    old_title TEXT,
    new_title TEXT,
    changed_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION log_books_update() RETURNS trigger AS $$
BEGIN
    INSERT INTO books_audit (book_id, old_title, new_title)
    VALUES (NEW.id, OLD.title, NEW.title);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'books_audit_trg'
            AND c.relname = 'books'
            AND n.nspname = 'public'
    ) THEN
        CREATE TRIGGER books_audit_trg
        AFTER UPDATE ON books
        FOR EACH ROW
        EXECUTE FUNCTION log_books_update();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'books_audit_always_trg'
            AND c.relname = 'books'
            AND n.nspname = 'public'
    ) THEN
        CREATE TRIGGER books_audit_always_trg
        AFTER UPDATE ON books
        FOR EACH ROW
        EXECUTE FUNCTION log_books_update();
    END IF;
END $$;

ALTER TABLE books ENABLE REPLICA TRIGGER books_audit_trg;
ALTER TABLE books ENABLE ALWAYS TRIGGER books_audit_always_trg;

CREATE INDEX IF NOT EXISTS books_title_lower_idx ON books (lower(title));
CREATE INDEX IF NOT EXISTS books_author_inc_idx ON books (author_id) INCLUDE (isbn);
CREATE INDEX IF NOT EXISTS books_title_partial_idx ON books (title) WHERE title IS NOT NULL;

INSERT INTO authors (id, name, email) VALUES (1, 'Ada Lovelace', 'ada@example.com') ON CONFLICT DO NOTHING;
INSERT INTO books (id, author_id, title, isbn) VALUES (1, 1, 'Analytical Sketches', 'ISBN-1') ON CONFLICT DO NOTHING;
INSERT INTO events (id, happened_on, payload) VALUES (1, '2024-06-01', 'public partition row') ON CONFLICT DO NOTHING;
INSERT INTO events (id, happened_on, payload) VALUES (2, '2025-02-01', 'archive partition row') ON CONFLICT DO NOTHING;

-- Create a role for macOS keychain-backed testing
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kc_pg_user') THEN
        CREATE ROLE kc_pg_user LOGIN PASSWORD 'SuperSecret!12345';
    END IF;
END $$;

GRANT ALL PRIVILEGES ON DATABASE testdb TO kc_pg_user;
GRANT USAGE ON SCHEMA public TO kc_pg_user;
GRANT USAGE ON SCHEMA archive TO kc_pg_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kc_pg_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA archive TO kc_pg_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kc_pg_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA archive TO kc_pg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kc_pg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kc_pg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO kc_pg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive
    GRANT USAGE, SELECT ON SEQUENCES TO kc_pg_user;

-- Reset sequences to account for explicit id inserts
SELECT setval('authors_id_seq', (SELECT MAX(id) FROM authors));
SELECT setval('books_id_seq', (SELECT MAX(id) FROM books));
SELECT setval('events_id_seq', (SELECT MAX(id) FROM events));
