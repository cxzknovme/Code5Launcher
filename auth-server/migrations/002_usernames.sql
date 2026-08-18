ALTER TABLE email_challenges
  ADD COLUMN IF NOT EXISTS game_name VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS users_game_name_lower_unique
  ON users (LOWER(game_name));
