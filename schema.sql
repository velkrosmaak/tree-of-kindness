
        DROP TABLE IF EXISTS cobnuts_tracker;
        CREATE TABLE cobnuts_tracker (
            id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensures only one row
            current_cobnuts_in_jar INTEGER NOT NULL DEFAULT 0,
            total_cobnuts_earned INTEGER NOT NULL DEFAULT 0
        );
        