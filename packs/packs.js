module.exports = {
  banana: {
    emoji: '<:pack_banana:1413292531134759053>',
    name: 'Banana Pack',
    code: 'banana',
    price: 1500,
    config: [{ rarity: 1, count: 4 }, { rarity: 2, count: 1 }]
  },
  grape: {
    emoji: '<:pack_grape:1413292369675157655>',
    name: 'Grape Pack',
    code: 'grape',
    price: 2500,
    config: [{ rarity: 1, count: 2 }, { rarity: 2, count: 3 }]
  },
  kiwi: {
    emoji: '<:pack_kiwi:1413292487455408201>',
    name: 'Kiwi Pack',
    code: 'kiwi',
    price: 4000,
    config: [{ rarity: 1, count: 2 }, { rarity: 2, count: 2 }, { rarity: 3, count: 1 }]
  },
  orange: {
    emoji: '<:pack_orange:1413292302050394153>',
    name: 'Orange Pack',
    code: 'orange',
    price: 8000,
    type: 'random5_group' // 👈 5 random, necesita grupo
  },
  strawberry: {
    emoji: '<:pack_strawberry:1413292056830545970>',
    name: 'Strawberry Pack',
    code: 'strawberry',
    price: 10000,
    type: 'random5_group_idol' // 👈 5 random, necesita grupo + idol
  }
};
