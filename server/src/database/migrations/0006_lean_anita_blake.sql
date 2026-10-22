CREATE TABLE `jersey_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `jersey_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `jersey_categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `leagues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(140) NOT NULL,
	`country` varchar(80) NOT NULL,
	`country_code` varchar(2) NOT NULL,
	`season` varchar(20) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `leagues_id` PRIMARY KEY(`id`),
	CONSTRAINT `leagues_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`league_id` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(140) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `teams_league_slug_unique` UNIQUE(`league_id`,`slug`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `team_id` int;--> statement-breakpoint
ALTER TABLE `products` ADD `jersey_category_id` int;--> statement-breakpoint
ALTER TABLE `teams` ADD CONSTRAINT `teams_league_id_leagues_id_fk` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `leagues_active_order_idx` ON `leagues` (`active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `teams_league_active_order_idx` ON `teams` (`league_id`,`active`,`sort_order`);--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_jersey_category_id_jersey_categories_id_fk` FOREIGN KEY (`jersey_category_id`) REFERENCES `jersey_categories`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO `leagues` (`name`, `slug`, `country`, `country_code`, `season`, `sort_order`, `active`) VALUES
	('Premier League', 'premier-league', 'England', 'GB', '2025/26', 1, true),
	('Ligue 1', 'ligue-1', 'France', 'FR', '2025/26', 2, true),
	('Bundesliga', 'bundesliga', 'Germany', 'DE', '2025/26', 3, true),
	('La Liga', 'la-liga', 'Spain', 'ES', '2025/26', 4, true),
	('Serie A', 'serie-a', 'Italy', 'IT', '2025/26', 5, true)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `country` = VALUES(`country`), `country_code` = VALUES(`country_code`), `season` = VALUES(`season`), `sort_order` = VALUES(`sort_order`), `active` = VALUES(`active`);
--> statement-breakpoint
INSERT INTO `teams` (`league_id`, `name`, `slug`, `sort_order`, `active`)
SELECT league.id, seed.name, seed.slug, seed.sort_order, true
FROM `leagues` AS league
JOIN (
	SELECT 'premier-league' AS league_slug, 'Arsenal' AS name, 'arsenal' AS slug, 1 AS sort_order UNION ALL
	SELECT 'premier-league', 'Aston Villa', 'aston-villa', 2 UNION ALL
	SELECT 'premier-league', 'AFC Bournemouth', 'afc-bournemouth', 3 UNION ALL
	SELECT 'premier-league', 'Brentford', 'brentford', 4 UNION ALL
	SELECT 'premier-league', 'Brighton & Hove Albion', 'brighton-hove-albion', 5 UNION ALL
	SELECT 'premier-league', 'Burnley', 'burnley', 6 UNION ALL
	SELECT 'premier-league', 'Chelsea', 'chelsea', 7 UNION ALL
	SELECT 'premier-league', 'Crystal Palace', 'crystal-palace', 8 UNION ALL
	SELECT 'premier-league', 'Everton', 'everton', 9 UNION ALL
	SELECT 'premier-league', 'Fulham', 'fulham', 10 UNION ALL
	SELECT 'premier-league', 'Leeds United', 'leeds-united', 11 UNION ALL
	SELECT 'premier-league', 'Liverpool', 'liverpool', 12 UNION ALL
	SELECT 'premier-league', 'Manchester City', 'manchester-city', 13 UNION ALL
	SELECT 'premier-league', 'Manchester United', 'manchester-united', 14 UNION ALL
	SELECT 'premier-league', 'Newcastle United', 'newcastle-united', 15 UNION ALL
	SELECT 'premier-league', 'Nottingham Forest', 'nottingham-forest', 16 UNION ALL
	SELECT 'premier-league', 'Sunderland', 'sunderland', 17 UNION ALL
	SELECT 'premier-league', 'Tottenham Hotspur', 'tottenham-hotspur', 18 UNION ALL
	SELECT 'premier-league', 'West Ham United', 'west-ham-united', 19 UNION ALL
	SELECT 'premier-league', 'Wolverhampton Wanderers', 'wolverhampton-wanderers', 20 UNION ALL
	SELECT 'ligue-1', 'Angers', 'angers', 1 UNION ALL
	SELECT 'ligue-1', 'Auxerre', 'auxerre', 2 UNION ALL
	SELECT 'ligue-1', 'Brest', 'brest', 3 UNION ALL
	SELECT 'ligue-1', 'Le Havre', 'le-havre', 4 UNION ALL
	SELECT 'ligue-1', 'Lens', 'lens', 5 UNION ALL
	SELECT 'ligue-1', 'Lille', 'lille', 6 UNION ALL
	SELECT 'ligue-1', 'Lorient', 'lorient', 7 UNION ALL
	SELECT 'ligue-1', 'Lyon', 'lyon', 8 UNION ALL
	SELECT 'ligue-1', 'Marseille', 'marseille', 9 UNION ALL
	SELECT 'ligue-1', 'Metz', 'metz', 10 UNION ALL
	SELECT 'ligue-1', 'Monaco', 'monaco', 11 UNION ALL
	SELECT 'ligue-1', 'Nantes', 'nantes', 12 UNION ALL
	SELECT 'ligue-1', 'Nice', 'nice', 13 UNION ALL
	SELECT 'ligue-1', 'Paris FC', 'paris-fc', 14 UNION ALL
	SELECT 'ligue-1', 'Paris Saint-Germain', 'paris-saint-germain', 15 UNION ALL
	SELECT 'ligue-1', 'Rennes', 'rennes', 16 UNION ALL
	SELECT 'ligue-1', 'Strasbourg', 'strasbourg', 17 UNION ALL
	SELECT 'ligue-1', 'Toulouse', 'toulouse', 18 UNION ALL
	SELECT 'bundesliga', 'Augsburg', 'augsburg', 1 UNION ALL
	SELECT 'bundesliga', 'Bayer Leverkusen', 'bayer-leverkusen', 2 UNION ALL
	SELECT 'bundesliga', 'Bayern Munich', 'bayern-munich', 3 UNION ALL
	SELECT 'bundesliga', 'Borussia Dortmund', 'borussia-dortmund', 4 UNION ALL
	SELECT 'bundesliga', 'Borussia Mönchengladbach', 'borussia-monchengladbach', 5 UNION ALL
	SELECT 'bundesliga', 'Eintracht Frankfurt', 'eintracht-frankfurt', 6 UNION ALL
	SELECT 'bundesliga', 'FC Köln', 'fc-koln', 7 UNION ALL
	SELECT 'bundesliga', 'Freiburg', 'freiburg', 8 UNION ALL
	SELECT 'bundesliga', 'Hamburg', 'hamburg', 9 UNION ALL
	SELECT 'bundesliga', 'Heidenheim', 'heidenheim', 10 UNION ALL
	SELECT 'bundesliga', 'Hoffenheim', 'hoffenheim', 11 UNION ALL
	SELECT 'bundesliga', 'Mainz 05', 'mainz-05', 12 UNION ALL
	SELECT 'bundesliga', 'RB Leipzig', 'rb-leipzig', 13 UNION ALL
	SELECT 'bundesliga', 'St. Pauli', 'st-pauli', 14 UNION ALL
	SELECT 'bundesliga', 'Stuttgart', 'stuttgart', 15 UNION ALL
	SELECT 'bundesliga', 'Union Berlin', 'union-berlin', 16 UNION ALL
	SELECT 'bundesliga', 'Werder Bremen', 'werder-bremen', 17 UNION ALL
	SELECT 'bundesliga', 'Wolfsburg', 'wolfsburg', 18 UNION ALL
	SELECT 'la-liga', 'Alavés', 'alaves', 1 UNION ALL
	SELECT 'la-liga', 'Athletic Club', 'athletic-club', 2 UNION ALL
	SELECT 'la-liga', 'Atlético Madrid', 'atletico-madrid', 3 UNION ALL
	SELECT 'la-liga', 'Barcelona', 'barcelona', 4 UNION ALL
	SELECT 'la-liga', 'Celta Vigo', 'celta-vigo', 5 UNION ALL
	SELECT 'la-liga', 'Elche', 'elche', 6 UNION ALL
	SELECT 'la-liga', 'Espanyol', 'espanyol', 7 UNION ALL
	SELECT 'la-liga', 'Getafe', 'getafe', 8 UNION ALL
	SELECT 'la-liga', 'Girona', 'girona', 9 UNION ALL
	SELECT 'la-liga', 'Levante', 'levante', 10 UNION ALL
	SELECT 'la-liga', 'Mallorca', 'mallorca', 11 UNION ALL
	SELECT 'la-liga', 'Osasuna', 'osasuna', 12 UNION ALL
	SELECT 'la-liga', 'Real Oviedo', 'real-oviedo', 13 UNION ALL
	SELECT 'la-liga', 'Rayo Vallecano', 'rayo-vallecano', 14 UNION ALL
	SELECT 'la-liga', 'Real Betis', 'real-betis', 15 UNION ALL
	SELECT 'la-liga', 'Real Madrid', 'real-madrid', 16 UNION ALL
	SELECT 'la-liga', 'Real Sociedad', 'real-sociedad', 17 UNION ALL
	SELECT 'la-liga', 'Sevilla', 'sevilla', 18 UNION ALL
	SELECT 'la-liga', 'Valencia', 'valencia', 19 UNION ALL
	SELECT 'la-liga', 'Villarreal', 'villarreal', 20 UNION ALL
	SELECT 'serie-a', 'Atalanta', 'atalanta', 1 UNION ALL
	SELECT 'serie-a', 'Bologna', 'bologna', 2 UNION ALL
	SELECT 'serie-a', 'Cagliari', 'cagliari', 3 UNION ALL
	SELECT 'serie-a', 'Como', 'como', 4 UNION ALL
	SELECT 'serie-a', 'Cremonese', 'cremonese', 5 UNION ALL
	SELECT 'serie-a', 'Fiorentina', 'fiorentina', 6 UNION ALL
	SELECT 'serie-a', 'Genoa', 'genoa', 7 UNION ALL
	SELECT 'serie-a', 'Inter', 'inter', 8 UNION ALL
	SELECT 'serie-a', 'Juventus', 'juventus', 9 UNION ALL
	SELECT 'serie-a', 'Lazio', 'lazio', 10 UNION ALL
	SELECT 'serie-a', 'Lecce', 'lecce', 11 UNION ALL
	SELECT 'serie-a', 'Milan', 'milan', 12 UNION ALL
	SELECT 'serie-a', 'Napoli', 'napoli', 13 UNION ALL
	SELECT 'serie-a', 'Parma', 'parma', 14 UNION ALL
	SELECT 'serie-a', 'Pisa', 'pisa', 15 UNION ALL
	SELECT 'serie-a', 'Roma', 'roma', 16 UNION ALL
	SELECT 'serie-a', 'Sassuolo', 'sassuolo', 17 UNION ALL
	SELECT 'serie-a', 'Torino', 'torino', 18 UNION ALL
	SELECT 'serie-a', 'Udinese', 'udinese', 19 UNION ALL
	SELECT 'serie-a', 'Verona', 'verona', 20
) AS seed ON league.slug = seed.league_slug
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `sort_order` = VALUES(`sort_order`), `active` = VALUES(`active`);
--> statement-breakpoint
INSERT INTO `jersey_categories` (`name`, `slug`, `sort_order`, `active`) VALUES
	('Home', 'home', 1, true),
	('Away', 'away', 2, true),
	('Third', 'third', 3, true),
	('Goalkeeper', 'goalkeeper', 4, true),
	('Training', 'training', 5, true),
	('Retro', 'retro', 6, true),
	('Kids', 'kids', 7, true)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `sort_order` = VALUES(`sort_order`), `active` = VALUES(`active`);