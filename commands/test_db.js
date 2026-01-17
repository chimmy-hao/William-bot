const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ID del Rol Permitido
const ALLOWED_ROLE = '1412852141197885464';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test_db')
    .setDescription('🩺 DIAGNÓSTICO: Revisa el estado de la base de datos (Solo Admin)'),

  async execute(interaction) {
    // 1. Verificación de Rol Estricta
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE)) {
        return interaction.reply({ content: '🚫 No tienes permiso para ver el diagnóstico del sistema.', ephemeral: true });
    }

    await interaction.deferReply();

    try {
        // --- CONSULTAS INDIVIDUALES ---

        // Rareza 1 (Común)
        const { count: countR1, error: err1 } = await supabase
            .from('base_cards')
            .select('*', { count: 'exact', head: true })
            .eq('rarity_level', 1)
            .eq('is_active', true);

        // Rareza 2 (Rara) - La que usa el Daily
        const { count: countR2, error: err2 } = await supabase
            .from('base_cards')
            .select('*', { count: 'exact', head: true })
            .eq('rarity_level', 2)
            .eq('is_active', true);

        // Rareza 3 (Legendaria)
        const { count: countR3, error: err3 } = await supabase
            .from('base_cards')
            .select('*', { count: 'exact', head: true })
            .eq('rarity_level', 3)
            .eq('is_active', true);

        // Eventos (Cualquiera que tenga texto en event_type)
        const { count: countEvents, error: errEv } = await supabase
            .from('base_cards')
            .select('*', { count: 'exact', head: true })
            .not('event_type', 'is', null)
            .eq('is_active', true);

        // Verificación de RLS / Error General
        if (err1 || err2 || err3) {
            const errorMsg = err1?.message || err2?.message || err3?.message;
            return interaction.editReply(`❌ **ERROR DE CONEXIÓN CON SUPABASE**\nEl bot no puede leer las cartas.\n\n**Detalle:** \`${errorMsg}\`\n\n💡 *Solución:* Revisa los "RLS Policies" en Supabase y asegúrate de haber ejecutado el comando SQL de lectura pública.`);
        }

        // --- CONSTRUCCIÓN DEL REPORTE ---
        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('🩺 Diagnóstico de Base de Datos')
            .setDescription('Estado actual de las cartas **ACTIVAS** (`is_active: true`).')
            .addFields(
                { name: '🍓 Rareza 1 (Común)', value: `**${countR1 || 0}** cartas`, inline: true },
                { name: '🍓🍓 Rareza 2 (Rara)', value: `**${countR2 || 0}** cartas`, inline: true },
                { name: '🍓🍓🍓 Rareza 3 (Legendaria)', value: `**${countR3 || 0}** cartas`, inline: true },
                { name: '🎉 De Evento', value: `**${countEvents || 0}** cartas`, inline: true },
                { name: '📊 Total Visible', value: `**${(countR1 || 0) + (countR2 || 0) + (countR3 || 0)}** cartas`, inline: false }
            )
            .setFooter({ text: 'Si ves "0" en alguna categoría que debería tener cartas, revisa la base de datos.' })
            .setTimestamp();

        // ANÁLISIS AUTOMÁTICO PARA DAILY
        let statusDaily = "";
        if ((countR2 || 0) > 0) {
            statusDaily = "✅ **OPERATIVO:** Hay cartas de Rareza 2 para entregar.";
        } else {
            statusDaily = "⚠️ **PELIGRO:** No hay cartas de Rareza 2. El comando `/daily` fallará si no hay eventos activos.";
        }
        
        embed.addFields({ name: 'Estado del Daily', value: statusDaily });

        await interaction.editReply({ embeds: [embed] });

    } catch (err) {
        console.error(err);
        await interaction.editReply(`❌ **Error Interno:** ${err.message}`);
    }
  }
};
