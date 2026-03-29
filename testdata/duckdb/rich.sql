CREATE SCHEMA analytics;
CREATE SCHEMA marts;

CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');

CREATE SEQUENCE analytics.event_seq START 100 INCREMENT 5;

CREATE TABLE analytics.authors (
    id BIGINT PRIMARY KEY,
    email VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    status mood DEFAULT 'ok',
    bio TEXT,
    profile JSON,
    rating DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT current_timestamp,
    CONSTRAINT authors_name_check CHECK (length(name) >= 2)
);

COMMENT ON TABLE analytics.authors IS 'Authors master data';

CREATE TABLE analytics.books (
    id BIGINT PRIMARY KEY,
    author_id BIGINT NOT NULL,
    title VARCHAR NOT NULL,
    isbn VARCHAR UNIQUE,
    price DECIMAL(10, 2) NOT NULL,
    tags VARCHAR[],
    published_on DATE,
    payload STRUCT(editions INTEGER, featured BOOLEAN),
    CONSTRAINT books_price_check CHECK (price >= 0),
    CONSTRAINT books_author_fkey FOREIGN KEY (author_id) REFERENCES analytics.authors(id),
    CONSTRAINT books_title_price_unique UNIQUE (title, price)
);

CREATE TABLE analytics.book_editions (
    book_id BIGINT NOT NULL,
    edition_no INTEGER NOT NULL,
    warehouse_code VARCHAR NOT NULL,
    stock INTEGER DEFAULT 0,
    seq_value BIGINT DEFAULT nextval('analytics.event_seq'),
    CONSTRAINT book_editions_stock_check CHECK (stock >= 0),
    CONSTRAINT book_editions_pk PRIMARY KEY (book_id, edition_no),
    CONSTRAINT book_editions_book_fkey FOREIGN KEY (book_id) REFERENCES analytics.books(id)
);

CREATE TABLE analytics.daily_sales (
    book_id BIGINT NOT NULL,
    sales_date DATE NOT NULL,
    copies_sold INTEGER NOT NULL,
    revenue DECIMAL(12, 2) NOT NULL,
    CONSTRAINT daily_sales_pk PRIMARY KEY (book_id, sales_date),
    CONSTRAINT daily_sales_copies_check CHECK (copies_sold >= 0),
    CONSTRAINT daily_sales_revenue_check CHECK (revenue >= 0),
    CONSTRAINT daily_sales_book_fkey FOREIGN KEY (book_id) REFERENCES analytics.books(id)
);

CREATE INDEX books_title_idx ON analytics.books(title);
CREATE UNIQUE INDEX authors_email_name_idx ON analytics.authors(email, name);
CREATE INDEX daily_sales_date_book_idx ON analytics.daily_sales(sales_date, book_id);

CREATE VIEW analytics.author_books AS
SELECT
    a.id AS author_id,
    a.name AS author_name,
    b.id AS book_id,
    b.title,
    b.price,
    b.tags
FROM analytics.authors a
LEFT JOIN analytics.books b ON b.author_id = a.id;

CREATE VIEW marts.author_revenue AS
SELECT
    ab.author_id,
    ab.author_name,
    COALESCE(SUM(ds.revenue), 0)::DECIMAL(18, 2) AS total_revenue,
    COUNT(DISTINCT ab.book_id) AS book_count
FROM analytics.author_books ab
LEFT JOIN analytics.daily_sales ds ON ds.book_id = ab.book_id
GROUP BY 1, 2;

CREATE MACRO analytics.book_label(title_value, price_value) AS title_value || ' ($' || price_value || ')';

INSERT INTO analytics.authors (id, email, name, status, bio, profile, rating) VALUES
    (1, 'ada@example.com', 'Ada Lovelace', 'happy', 'Writes analytical notes', '{"awards":["Royal Society"]}'::JSON, 9.75),
    (2, 'grace@example.com', 'Grace Hopper', 'ok', 'Builds compilers', '{"awards":["National Medal of Technology"]}'::JSON, 9.50);

INSERT INTO analytics.books (id, author_id, title, isbn, price, tags, published_on, payload) VALUES
    (10, 1, 'Analytical Engine Notes', 'ISBN-10', 49.99, ['history', 'math'], DATE '1843-07-01', {'editions': 2, 'featured': true}),
    (11, 2, 'Compiler Construction', 'ISBN-11', 59.00, ['systems', 'programming'], DATE '1952-03-01', {'editions': 3, 'featured': false});

INSERT INTO analytics.book_editions (book_id, edition_no, warehouse_code, stock) VALUES
    (10, 1, 'eu-west', 15),
    (10, 2, 'us-east', 7),
    (11, 1, 'eu-west', 9);

INSERT INTO analytics.daily_sales (book_id, sales_date, copies_sold, revenue) VALUES
    (10, DATE '2025-01-01', 3, 149.97),
    (10, DATE '2025-01-02', 1, 49.99),
    (11, DATE '2025-01-02', 2, 118.00);
