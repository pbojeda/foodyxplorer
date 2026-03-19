-- Create pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
-- Create pg_trgm extension (required for Level 4 trigram similarity search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create test database
SELECT 'CREATE DATABASE foodxplorer_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'foodxplorer_test')\gexec

-- Enable pgvector on test database
\c foodxplorer_test
CREATE EXTENSION IF NOT EXISTS vector;
-- Enable pg_trgm on test database (required for Level 4 trigram similarity search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
