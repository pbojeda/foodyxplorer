-- Create pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create test database
SELECT 'CREATE DATABASE foodxplorer_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'foodxplorer_test')\gexec

-- Enable pgvector on test database
\c foodxplorer_test
CREATE EXTENSION IF NOT EXISTS vector;
