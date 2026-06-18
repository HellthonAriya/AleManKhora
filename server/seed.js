/**
 * AleManKhora — Seed script
 * Creates an admin account and a few demo players for testing/leaderboard.
 *   node server/seed.js
 */
import db from './db.js';
import { Users } from './models.js';

async function seed() {
  const demo = [
    { username: 'admin', email: 'admin@alemankhora.app', password: 'admin123', isAdmin: true, elo: 1450, wins: 22, losses: 8 },
    { username: 'Sina', password: 'sina123', elo: 1320, wins: 14, losses: 9 },
    { username: 'Niloofar', password: 'nilo123', elo: 1280, wins: 11, losses: 7 },
    { username: 'Arman', password: 'arman123', elo: 1190, wins: 8, losses: 10 },
    { username: 'Tara', password: 'tara123', elo: 1100, wins: 4, losses: 6 },
  ];

  for (const d of demo) {
    if (Users.byUsername(d.username)) {
      console.log(`- ${d.username} already exists, skipping`);
      continue;
    }
    const user = await Users.create({
      username: d.username, email: d.email, password: d.password, isAdmin: d.isAdmin,
    });
    db.prepare(
      'UPDATE users SET elo=?, wins=?, losses=?, games_played=? WHERE id=?'
    ).run(d.elo, d.wins ?? 0, d.losses ?? 0, (d.wins ?? 0) + (d.losses ?? 0), user.id);
    console.log(`✓ created ${d.username}${d.isAdmin ? ' (admin)' : ''}`);
  }
  console.log('\nSeed complete. Admin login → username: admin / password: admin123\n');
}

seed();
