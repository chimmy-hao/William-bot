const { SlashCommandBuilder } = require('discord.js'); 
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Lista fija de packs con emojis y precio (sin cambiar)
const packsList = {
  banana: { name: 'Banana Pack', emoji: '<:pack_banana:1413292531134759053>', price: 1500 },
  grape: { name: 'Grape Pack', emoji: '<:pack_grape:1413292369675157655>', price: 2500 },
  kiwi: { name: 'Kiwi Pack', emoji: '<:pack_kiwi:1413292487455408201>', price: 4000 },
  orange: { name: 'Orange Pack', emoji: '<:pack_orange:1413292302050394153>', price: 8000 },
  strawberry: { name: 'Strawberry Pack', emoji: '<:pack_strawberry:1413292056830545970>', price: 10000 }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('💰 Comprar un pack de photocards')
    .addStringOption(opt =>
      opt.setName('pack')
        .setDescription('El pack que querés comprar')
        .setAutocomplete(true)
        .setRequired(true)
    ),

  // Autocomplete
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'pack') {
      // Tomamos todos los packs de la lista
      const choices = Object.entries(packsList).map(([code, pack]) => ({
        name: `${pack.emoji} ${pack.name} (${pack.price} <:berrycoin:1411737957081288724>)`,
        value: code
      }));

      const filtered = choices
        .filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase()))
        .slice(0, 25);

      return interaction.respond(filtered);
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const packCode = interaction.options.getString('pack');
    const pack = packsList[packCode];

    if (!pack) return interaction.reply({ content: '❌ Pack inválido.', ephemeral: true });

    try {
      // Asegurarse de que el usuario exista
      let { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!userData) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({ user_id: userId, username, balance: 0 })
          .select()
          .single();
        userData = newUser;
      }

      // Verificar balance
      if (userData.balance < pack.price) {
        return interaction.reply({ content: `❌ No tienes suficientes :berrycoin:`, ephemeral: true });
      }

      // Restar balance
      const { error: updateBalanceError } = await supabase
        .from('users')
        .update({ balance: userData.balance - pack.price })
        .eq('user_id', userId);

      if (updateBalanceError) {
        console.error('Error actualizando balance:', updateBalanceError);
        return interaction.reply({ content: '❌ Error al actualizar tu balance.', ephemeral: true });
      }

      // Actualizar o insertar pack en user_packs
      const { error: upsertError } = await supabase
        .from('user_packs')
        .upsert(
          { user_id: userId, pack_code: packCode, quantity: 1 },
          { onConflict: ['user_id', 'pack_code'] }
        );

      if (upsertError) {
        console.error('Error al agregar pack al inventario:', upsertError);
        return interaction.reply({ content: '❌ Error al registrar tu pack.', ephemeral: true });
      }

      return interaction.reply({
        content: `✅ Compraste 1 ${pack.emoji} ${pack.name} por ${pack.price} <:berrycoin:1411737957081288724>`,
        ephemeral: false
      });

    } catch (err) {
      console.error('Error en /buy:', err);
      return interaction.reply({ content: '❌ Ocurrió un error al intentar comprar el pack.', ephemeral: true });
    }
  }
};



