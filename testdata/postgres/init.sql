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

-- Reset sequences to account for explicit id inserts
SELECT setval('authors_id_seq', (SELECT MAX(id) FROM authors));
SELECT setval('books_id_seq', (SELECT MAX(id) FROM books));
