-- A link's site icon (from <link rel="icon"> or apple-touch-icon), read with its title. NULL = none found or not read yet;
-- clients then try the site's /favicon.ico and fall back to the globe.
ALTER TABLE files ADD COLUMN icon_url TEXT;
