const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Configuración para el Canvas Individual (Basado en tamaño BIG para mejor calidad)
const CANVAS_CONFIG = {
    w: 642,
    h: 1032
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('view')
        .setDescription('📸 Mira tus cartas. (1 carta = Detalle con Marco | Varias = Grid)')
        .addStringOption(option =>
            option.setName('codes')
                .setDescription('Código(s) de las cartas (separados por espacio)')
                .setRequired(true)
        ),

    async execute(interaction) {
        const userId = interaction.user.id;
        const inputCodes = interaction.options.getString('codes');

        // Limpiar códigos
        const codesRaw = inputCodes.split(/[\s,]+/).filter(c => c.length > 0);
        const codes = [...new Set(codesRaw)].slice(0, 9); 

        if (codes.length === 0) return interaction.reply({ content: '❌ Escribe al menos un código.', ephemeral: true });

        try {
            await interaction.deferReply();

            // 1. Buscar cartas + Info de Holders + Info Base
            const { data: userCards, error } = await supabase
                .from('user_cards')
                .select(`
                    unique_card_id,
                    rarity,
                    created_at,
                    base_cards (image_url, name, group_name, era, creator),
                    holders!equipped_holder_id (code, image_url, name, emoji, creator_id)
                `)
                .in('unique_card_id', codes)
                .eq('user_id', userId);

            if (error || !userCards || userCards.length === 0) {
                return interaction.editReply('❌ No se encontraron las cartas o no te pertenecen.');
            }

            // Validar que todos los códigos sean correctos
            const foundIds = userCards.map(c => c.unique_card_id);
            const invalidCodes = codes.filter(code => !foundIds.includes(code));
            if (invalidCodes.length > 0) {
                return interaction.editReply({ content: `⚠️ Algunos códigos no son válidos o no son tuyos: ${invalidCodes.join(', ')}`, ephemeral: true });
            }

            // ==================================================
            // 🎨 MODO SINGLE (SHOWCASE) - ESTILO "GARAM"
            // ==================================================
            if (userCards.length === 1) {
                const card = userCards[0];
                const holder = card.holders; // Datos del holder (si tiene)
                const base = card.base_cards;

                // Crear Canvas
                const canvas = createCanvas(CANVAS_CONFIG.w, CANVAS_CONFIG.h);
                const ctx = canvas.getContext('2d');

                // 1. Dibujar Carta Base
                try {
                    const cardImg = await loadImage(base.image_url);
                    // Dibujamos la carta estirada al tamaño del canvas (o podrías centrarla)
                    // Para que el holder encaje perfecto, asumimos que llenan el espacio
                    ctx.drawImage(cardImg, 0, 0, CANVAS_CONFIG.w, CANVAS_CONFIG.h);
                } catch (e) {
                    console.error("Error img carta:", e);
                }

                // 2. Dibujar Holder (Si existe)
                if (holder && holder.image_url) {
                    try {
                        const holderImg = await loadImage(holder.image_url);
                        ctx.drawImage(holderImg, 0, 0, CANVAS_CONFIG.w, CANVAS_CONFIG.h);
                    } catch (e) {
                        console.error("Error img holder:", e);
                    }
                }

                // Generar archivo
                const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: `card-${card.unique_card_id}.png` });

                // 3. Construir el Embed Estilo Garam
                // Formato:
                // Título: Nombre del Idol + Grupo + Era
                // Desc: Info técnica y créditos del holder
                
                const date = new Date(card.created_at).toLocaleDateString('es-ES');
                const cardCreator = base.creator ? `Made by @${base.creator}` : 'System Drop';
                
                let description = `**${base.group_name}** — ${base.era} ✨\n`;
                description += `Rareza ${card.rarity} — \`${card.unique_card_id}\`\n`;
                description += `Dropped at ${date}, ${cardCreator}.\n\n`;

                if (holder) {
                    description += `**Card holder** \`${holder.code}\`: ${holder.emoji} ${holder.name}\n`;
                    description += `\`${holder.code}\` Made by <@${holder.creator_id}>`;
                } else {
                    description += `*No card holder equipped*`;
                }

                const embed = new EmbedBuilder()
                    .setColor(holder ? '#9b59b6' : '#2ecc71') // Color del holder o verde default
                    .setTitle(`${base.name}`) 
                    .setDescription(description)
                    .setImage(`attachment://card-${card.unique_card_id}.png`)
                    .setFooter({ text: `Owner: ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

                return interaction.editReply({ embeds: [embed], files: [attachment] });
            }

            // ==================================================
            // 📦 MODO GRID (MULTIVIEW) - TU CÓDIGO ORIGINAL
            // ==================================================
            else {
                // CONFIGURACIÓN ORIGINAL
                const cardWidth = 200;
                const cardHeight = 300;
                const gap = 20;
                const textSpace = 30; 
                const columns = 3;

                const rows = Math.ceil(userCards.length / columns);
                const actualCols = Math.min(userCards.length, columns);
                
                const finalWidth = (cardWidth * actualCols) + (gap * (actualCols + 1));
                const finalHeight = (cardHeight + textSpace) * rows + (gap * (rows + 1));

                const canvas = createCanvas(finalWidth, finalHeight);
                const ctx = canvas.getContext('2d');

                // Cargar imágenes
                const loadedImages = await Promise.all(
                    userCards.map(async (card) => {
                        try {
                            const img = await loadImage(card.base_cards.image_url);
                            return { img, ...card };
                        } catch (e) { return null; }
                    })
                );

                const validCards = loadedImages.filter(c => c !== null);

                // Dibujar
                for (let i = 0; i < validCards.length; i++) {
                    const card = validCards[i];
                    
                    const col = i % columns;
                    const row = Math.floor(i / columns);
                    const x = gap + (col * (cardWidth + gap));
                    const y = gap + (row * (cardHeight + textSpace + gap));

                    // Borde redondeado
                    const radius = 15; 
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x + radius, y);
                    ctx.lineTo(x + cardWidth - radius, y);
                    ctx.quadraticCurveTo(x + cardWidth, y, x + cardWidth, y + radius);
                    ctx.lineTo(x + cardWidth, y + cardHeight - radius);
                    ctx.quadraticCurveTo(x + cardWidth, y + cardHeight, x + cardWidth - radius, y + cardHeight);
                    ctx.lineTo(x + radius, y + cardHeight);
                    ctx.quadraticCurveTo(x, y + cardHeight, x, y + cardHeight - radius);
                    ctx.lineTo(x, y + radius);
                    ctx.quadraticCurveTo(x, y, x + radius, y);
                    ctx.closePath();
                    ctx.clip();
                    
                    ctx.drawImage(card.img, x, y, cardWidth, cardHeight);
                    ctx.restore();

                    // Texto (Solo en Grid)
                    const prefix = card.unique_card_id.split('.')[0];
                    ctx.font = '16px Arial'; 
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.shadowColor = "rgba(0,0,0,0.8)";
                    ctx.shadowBlur = 3;
                    ctx.lineWidth = 1;
                    const textX = x + (cardWidth / 2);
                    const textY = y + cardHeight + 20;
                    ctx.fillText(prefix, textX, textY);
                    ctx.shadowBlur = 0;
                }

                const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'collection-view.png' });

                await interaction.editReply({ 
                    content: `📸 Vista de colección de <@${userId}>`, 
                    files: [attachment] 
                });
            }

        } catch (err) {
            console.error('Error en view:', err);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ Ocurrió un error al generar la imagen.' }).catch(() => {});
            } else {
                await interaction.reply({ content: '❌ Ocurrió un error interno.', ephemeral: true }).catch(() => {});
            }
        }
    }
};
