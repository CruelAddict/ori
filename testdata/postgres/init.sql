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

INSERT INTO authors (id, name, email) VALUES (1, 'Ada Lovelace', 'ada@example.com') ON CONFLICT DO NOTHING;
INSERT INTO books (id, author_id, title, isbn) VALUES (1, 1, 'Analytical Sketches', 'ISBN-1') ON CONFLICT DO NOTHING;

-- Create a role for macOS keychain-backed testing
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kc_pg_user') THEN
        CREATE ROLE kc_pg_user LOGIN PASSWORD 'SuperSecret!12345';
    END IF;
END $$;

GRANT ALL PRIVILEGES ON DATABASE testdb TO kc_pg_user;
GRANT USAGE ON SCHEMA public TO kc_pg_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kc_pg_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kc_pg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kc_pg_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO kc_pg_user;

-- Reset sequences to account for explicit id inserts
SELECT setval('authors_id_seq', (SELECT MAX(id) FROM authors));
SELECT setval('books_id_seq', (SELECT MAX(id) FROM books));
