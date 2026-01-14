const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- ⚙️ CONFIGURACIÓN DEL EVENTO ⚙️ ---

// 1. ROLES PERMITIDOS (Ya configurados)
const ALLOWED_ROLES = [
    '1412852141197885464', 
    '1413313501694263357'
];

// 2. TABLA DE PROBABILIDADES (Loot Table)
const LOOT_TABLE = [
  { code: 'banana', chance: 30 },     // 30%
  { code: 'grape', chance: 30 },      // 30%
  { code: 'kiwi', chance: 20 },       // 20%
  { code: 'orange', chance: 15 },     // 15%
  { code: 'strawberry', chance: 5 }   // 5%
];

// Función de probabilidad ponderada
function pickRandomReward() {
  const totalWeight = LOOT_TABLE.reduce((sum, item) => sum + item.chance, 0);
  let random = Math.random() * totalWeight;
  
  for (const item of LOOT_TABLE) {
    if (random < item.chance) {
      return item.code;
    }
    random -= item.chance;
  }
  return LOOT_TABLE[0].code;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift_mystery')
    .setDescription('🎲 ADMIN: Crea un regalo misterioso con probabilidades')
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('¿Cuánto tiempo durará el evento?')
        .setRequired(true)
        .addChoices(
          { name: '10 minutos', value: '600000' },
          { name: '30 minutos', value: '1800000' },
          { name: '1 hora', value: '3600000' },
          { name: '6 horas', value: '21600000' },
          { name: '12 horas', value: '43200000' }
        )
    )
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Título del evento')
        .setRequired(false)
    ),

  async execute(interaction) {
    // --- 🔒 VERIFICACIÓN DE SEGURIDAD ---
    const hasPermission = interaction.member.roles.cache.some(role => ALLOWED_ROLES.includes(role.id));

    if (!hasPermission) {
      return interaction.reply({ content: '🚫 No tienes permisos para crear eventos misteriosos.', ephemeral: true });
    }

    try {
      await interaction.deferReply();

      const durationMs = parseInt(interaction.options.getString('duration'));
      const title = interaction.options.getString('title') || '🎁 Mystery Gift Event!';

      // Obtener datos visuales de los packs
      const codesToFetch = LOOT_TABLE.map(i => i.code);
      const { data: packsData, error } = await supabase
        .from('packs')
        .select('code, name, emoji')
        .in('code', codesToFetch);

      if (error || !packsData) {
        return interaction.editReply('❌ Error al leer la base de datos de packs.');
      }

      // Construir descripción visual
      let description = '¡Prueba tu suerte! Haz clic abajo para obtener uno de estos premios:\n\n';

      LOOT_TABLE.forEach(item => {
        const packInfo = packsData.find(p => p.code === item.code);
        if (packInfo) {
          description += `**${item.chance}%** chance de obtener **${packInfo.emoji} ${packInfo.name}**\n`;
        }
      });

      const endTime = Date.now() + durationMs;
      const expiryTimestamp = Math.floor(endTime / 1000);

      description += `\n⏳ Expira: <t:${expiryTimestamp}:R>`;

      const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: 'Total reclamados: 0' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('claim_mystery')
          .setLabel('Reclamar Mystery Gift')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎲')
      );

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // Collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: durationMs
      });

      const claimedUsers = new Set();

      collector.on('collect', async i => {
        if (i.customId === 'claim_mystery') {
          if (claimedUsers.has(i.user.id)) {
            return i.reply({ content: '❌ Ya reclamaste tu caja misteriosa.', ephemeral: true });
          }

          // Lógica de Premio
          const wonCode = pickRandomReward();
          const wonPack = packsData.find(p => p.code === wonCode);

          // Dar el pack
          const { data: currentPack } = await supabase
            .from('user_packs')
            .select('quantity')
            .eq('user_id', i.user.id)
            .eq('pack_code', wonCode)
            .single();

          const newQty = (currentPack?.quantity || 0) + 1;

          await supabase.from('users').upsert({ user_id: i.user.id, username: i.user.username });
          
          await supabase.from('user_packs').upsert(
            { user_id: i.user.id, pack_code: wonCode, quantity: newQty },
            { onConflict: ['user_id', 'pack_code'] }
          );

          // --- LOGGING NUEVO ---
          await supabase.from('gift_logs').insert({
            user_id: i.user.id,
            username: i.user.username,
            gift_type: 'mystery_pack',
            gift_detail: wonPack.name,
            event_source: 'gift_mystery'
          });
          // ---------------------

          claimedUsers.add(i.user.id);

          await i.reply({ 
            content: `🎉 **¡Felicidades!** Abriste el regalo y encontraste:\n# ${wonPack.emoji} ${wonPack.name}\n*(Se guardó en tu inventario)*`, 
            ephemeral: true 
          });

          // Actualizar contador
          const newEmbed = EmbedBuilder.from(embed)
            .setFooter({ text: `Total reclamados: ${claimedUsers.size}` });
          
          await message.edit({ embeds: [newEmbed] });
        }
      });

      collector.on('end', () => {
        const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(row.components[0]).setDisabled(true).setLabel('Evento Finalizado').setStyle(ButtonStyle.Secondary)
        );
        message.edit({ components: [disabledRow] }).catch(() => {});
      });

    } catch (err) {
      console.error('Error en mystery gift:', err);
      await interaction.editReply('❌ Ocurrió un error al crear el evento.');
    }
  }
};
