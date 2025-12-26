const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('🍓 Muestra la lista de todos los comandos disponibles y para qué sirven.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🍓 Guía de Comandos de William')
            .setDescription('¡Hola! Soy William, el Main Vocalist de LYKN 🎤.\nAquí tienes la lista de todo lo que puedo hacer por ti en el servidor:')
            .setColor('#ff3366') // Un color fresa/rojo vibrante
            .setThumbnail(interaction.client.user.displayAvatarURL()) // Pone la foto del bot en pequeño
            .addFields(
                {
                    name: '💰 Economía y Obtención (Gacha)',
                    value: [
                        '**/photocard**: 🎲 Tira el gacha para obtener una carta gratis (cada 5 min).',
                        '**/daily**: 📅 Reclama tu recompensa diaria de monedas y carta (cada 12 hs).',
                        '**/weekly**: 🗓️ Reclama tu suministro semanal de Packs gratis (cada 7 días).',
                        '**/work**: 💼 Envía a tu idol favorito a trabajar para ganar Berrycoins.',
                        '**/shop**: 🛍️ Muestra el catálogo y precios de los Packs en la tienda.',
                        '**/buy**: 🛒 Compra Packs de la tienda o cartas del Marketplace.',
                        '**/use**: 🎁 Abre los packs que tienes en tu inventario.'
                    ].join('\n')
                },
                {
                    name: '📚 Gestión de Colección',
                    value: [
                        '**/inventory**: 🎒 Muestra todas tus cartas o tus packs guardados.',
                        '**/profile_view**: 👤 Muestra tu balance de monedas, estadísticas y tu idol principal.',
                        '**/view**: 📸 Genera una imagen (grid) de las cartas que elijas usando sus códigos.',
                        '**/checklist**: 📝 Muestra tu progreso y qué cartas te faltan de un grupo.',
                        '**/fav_photocard**: ⭐ Selecciona qué carta será tu "Main" (afecta al comando work).',
                        '**/nft**: 🔒 Gestiona tu lista "No For Trade" (marca idols que no cambias).',
                        '**/search**: 🔍 Busca quién tiene una carta específica en todo el servidor.',
                        '**/history**: 📜 Muestra el historial de una carta, un usuario o tus aperturas de packs.'
                    ].join('\n')
                },
                {
                    name: '🤝 Mercado e Intercambios',
                    value: [
                        '**/trade**: 🔄 Inicia un intercambio seguro de cartas/monedas con otro usuario.',
                        '**/transfer**: 💸 Regala cartas, monedas o packs a otro usuario directamente.',
                        '**/marketplace**: 🏪 Explora las cartas que otros jugadores han puesto a la venta.',
                        '**/sell**: 🏷️ Pon tus cartas a la venta en el mercado (o quítalas de la venta).'
                    ].join('\n')
                },
                {
                    name: '🎮 Juegos y Sistemas',
                    value: [
                        '**/licuadora**: 🌪️ Recicla tus cartas repetidas para crear Packs nuevos.',
                        '**/level_up**: ⬆️ Fusiona 10 cartas idénticas para obtener la versión de siguiente rareza.',
                        '**/alpha**: 🐺 Juego de riesgo: intenta evolucionar una carta con probabilidad de perderla.',
                        '**/world_tour**: ✈️ (Comando de evento/viaje - Descripción pendiente según tu código).',
                        '**/cooldowns**: ⏱️ Muestra cuánto tiempo te falta para usar tus comandos diarios/gacha.',
                        '**/notifications**: 🔔 Configura si quieres que el bot te avise cuando tus tiempos terminen.'
                    ].join('\n')
                }
            )
            .setFooter({ text: 'Usa los comandos con sabiduría 🍓 ✨' });

        // Enviamos el embed. Usamos ephemeral: true si quieres que solo lo vea quien lo pide.
        // Si quieres que lo vean todos, quita la línea de ephemeral.
        await interaction.reply({ embeds: [embed] /*, ephemeral: true */ });
    },
};
