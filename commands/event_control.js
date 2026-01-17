const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Roles permitidos (Tu ID y Staff)
const ALLOWED_ROLES = ['1412852141197885464'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event_control')
    .setDescription('⚙️ Staff: Activa o Desactiva eventos en los drops')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt => 
        opt.setName('evento')
           .setDescription('El nombre del evento a configurar')
           .setAutocomplete(true) // ✨ ¡Magia de autocompletado!
           .setRequired(true)
    )
    .addStringOption(opt => 
        opt.setName('estado')
           .setDescription('¿Prender o Apagar?')
           .setRequired(true)
           .addChoices(
               { name: '🟢 ACTIVAR (Que salgan cartas)', value: 'true' },
               { name: '🔴 DESACTIVAR (Que dejen de salir)', value: 'false' }
           )
    ),

  // --- AUTOCOMPLETADO INTELIGENTE ---
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    
    // 1. Buscamos qué tipos de eventos existen en las cartas subidas
    const { data } = await supabase
        .from('base_cards')
        .select('event_type')
        .not('event_type', 'is', null);

    if (!data) return interaction.respond([]);

    // 2. Filtramos duplicados (ej: si hay 100 cartas 'insta', solo mostramos 'insta' una vez)
    const uniqueEvents = [...new Set(data.map(item => item.event_type))];

    // 3. Filtramos según lo que escribes
    const filtered = uniqueEvents.filter(choice => choice.toLowerCase().includes(focusedValue));

    // 4. Respondemos a Discord
    await interaction.respond(
        filtered.map(choice => ({ name: choice.toUpperCase(), value: choice }))
    );
  },

  async execute(interaction) {
    // Verificar permisos
    if (!interaction.member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id))) {
        return interaction.reply({ content: '🚫 No tienes permisos.', ephemeral: true });
    }

    const eventName = interaction.options.getString('evento');
    const newState = interaction.options.getString('estado') === 'true'; // Convierte string a boolean

    await interaction.deferReply();

    try {
        // Guardamos o actualizamos la configuración en la nueva tabla
        const { error } = await supabase
            .from('events_config')
            .upsert({ 
                event_name: eventName, 
                is_active: newState 
            });

        if (error) throw error;

        // Feedback visual
        const color = newState ? '#2ecc71' : '#e74c3c';
        const statusText = newState ? '🟢 ACTIVADO' : '🔴 DESACTIVADO';
        const desc = newState 
            ? `¡Atención! Las cartas de **${eventName.toUpperCase()}** ahora aparecerán en Daily y Drops.`
            : `El evento **${eventName.toUpperCase()}** ha finalizado. Sus cartas ya no saldrán.`;

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`⚙️ Configuración de Evento: ${eventName.toUpperCase()}`)
            .setDescription(`Estado cambiado a: **${statusText}**\n\n${desc}`)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (err) {
        console.error(err);
        await interaction.editReply('❌ Hubo un error al guardar la configuración.');
    }
  }
};
