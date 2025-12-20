const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- MEDIDAS OFICIALES (Pixeles exactos) ---
const SIZES = {
    small:  { w: 543, h: 757,  label: 'Small (543x757)' },
    medium: { w: 642, h: 856,  label: 'Medium (642x856)' },
    big:    { w: 642, h: 1032, label: 'Big (642x1032)' }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cardholder')
        .setDescription('🎨 Sistema de marcos decorativos (Cardholders)')
        // --- SUBCOMANDO: CREATE ---
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Sube tu propio cardholder a la tienda.')
                .addStringOption(option => 
                    option.setName('code')
                        .setDescription('ID único del holder (Máx 5 letras)')
                        .setMaxLength(5)
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('name')
                        .setDescription('Nombre del cardholder')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('size')
                        .setDescription('Tamaño del marco')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Small (543x757)', value: 'small' },
                            { name: 'Medium (642x856)', value: 'medium' },
                            { name: 'Big (642x1032)', value: 'big' }
                        ))
                .addIntegerOption(option => 
                    option.setName('price')
                        .setDescription('Precio de venta (100 - 500)')
                        .setMinValue(100)
                        .setMaxValue(500)
                        .setRequired(true))
                .addAttachmentOption(option => 
                    option.setName('image')
                        .setDescription('Imagen PNG con fondo transparente')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('emoji')
                        .setDescription('Un emoji para identificarlo en la tienda'))
        )
        // --- SUBCOMANDO: SHOP (Para verlos) ---
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop')
                .setDescription('Ver los cardholders disponibles en el mercado.')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            // ======================================================
            // 🎨 LÓGICA DE CREATE
            // ======================================================
            if (subcommand === 'create') {
                await interaction.deferReply();

                // 1. OBTENER DATOS
                const code = interaction.options.getString('code').toUpperCase().trim();
                const name = interaction.options.getString('name');
                const sizeKey = interaction.options.getString('size');
                const price = interaction.options.getInteger('price');
                const attachment = interaction.options.getAttachment('image');
                const emoji = interaction.options.getString('emoji') || '🎨';

                // 2. VALIDACIONES BÁSICAS
                // Validar formato de ID (Solo letras/numeros, sin espacios)
                if (!/^[A-Z0-9]+$/.test(code)) {
                    return interaction.editReply('❌ El **Code** solo puede contener letras y números (sin espacios ni símbolos).');
                }

                // Validar formato de imagen
                if (attachment.contentType !== 'image/png') {
                    return interaction.editReply('❌ El archivo debe ser **formato PNG** (para soportar transparencia).');
                }

                // 3. VALIDACIÓN ESTRICTA DE MEDIDAS 📏
                const targetSize = SIZES[sizeKey];
                
                // Nota: Discord a veces tarda en procesar dimensiones. Si attachment.width es null, es un problema de Discord.
                if (!attachment.width || !attachment.height) {
                    return interaction.editReply('⚠️ No pude leer las dimensiones de la imagen. Intenta subirla desde PC o espera un momento.');
                }

                if (attachment.width !== targetSize.w || attachment.height !== targetSize.h) {
                    return interaction.editReply({
                        content: `❌ **Medidas Incorrectas.**\n` +
                                 `Elegiste tamaño **${sizeKey.toUpperCase()}**, por lo que tu imagen debe medir exactamente:\n` +
                                 `➡️ **${targetSize.w} ancho** x **${targetSize.h} alto** px.\n\n` +
                                 `Tu imagen mide: ${attachment.width}x${attachment.height}.`
                    });
                }

                // 4. VERIFICAR SI EL ID YA EXISTE EN DB
                const { data: existingHolder } = await supabase
                    .from('holders')
                    .select('code')
                    .eq('code', code)
                    .single();

                if (existingHolder) {
                    return interaction.editReply(`❌ El código **${code}** ya está en uso. Por favor elige otro.`);
                }

                // 5. GUARDAR EN SUPABASE
                const { error: insertError } = await supabase
                    .from('holders')
                    .insert({
                        code: code,
                        name: name,
                        creator_id: userId,
                        image_url: attachment.url,
                        price: price,
                        size: sizeKey,
                        emoji: emoji,
                        sales_count: 0
                    });

                if (insertError) throw insertError;

                // 6. DAR EL HOLDER AL CREADOR (Gratis por ser el dueño)
                // Primero necesitamos el ID numérico que se acaba de crear
                const { data: newHolder } = await supabase.from('holders').select('id').eq('code', code).single();
                
                if (newHolder) {
                    await supabase.from('user_holders').insert({
                        user_id: userId,
                        holder_id: newHolder.id
                    });
                }

                // 7. RESPUESTA ÉPICA
                const embed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle(`${emoji} Cardholder Creado: ${name}`)
                    .setDescription(
                        `¡Tu obra ha sido publicada en el mercado!\n\n` +
                        `🆔 **ID:** \`${code}\`\n` +
                        `📏 **Tamaño:** ${targetSize.label}\n` +
                        `💰 **Precio:** ${price} monedas\n` +
                        `📉 **Creator Royalty:** Recibirás el dinero de cada venta.`
                    )
                    .setThumbnail(attachment.url)
                    .setImage(attachment.url) // Mostramos preview grande
                    .setFooter({ text: `Creado por ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

                await interaction.editReply({ embeds: [embed] });
            }

            // ======================================================
            // 🛍️ LÓGICA DE SHOP (BÁSICA POR AHORA)
            // ======================================================
            else if (subcommand === 'shop') {
                await interaction.deferReply();

                const { data: holders, error } = await supabase
                    .from('holders')
                    .select('*')
                    .eq('is_active', true)
                    .order('created_at', { ascending: false }) // Los más nuevos primero
                    .limit(10); // Paginación simple

                if (error) throw error;

                if (!holders || holders.length === 0) {
                    return interaction.editReply('📭 La tienda de cardholders está vacía. ¡Usa `/cardholder create` para ser el primero!');
                }

                const embed = new EmbedBuilder()
                    .setColor('#e67e22')
                    .setTitle('🎨 Tienda de Cardholders (Últimos agregados)');

                let description = '';
                holders.forEach(h => {
                    description += `**${h.emoji} ${h.name}** (\`${h.code}\`)\n` +
                                   `💰 **${h.price}** • 📏 ${h.size.toUpperCase()} • 👤 <@${h.creator_id}>\n\n`;
                });
                
                // Nota: En el futuro agregaremos botones o menú desplegable para comprar
                description += `ℹ️ *Usa /cardholder buy [code] para comprar uno (Próximamente)*`;

                embed.setDescription(description);
                
                // Mostramos la imagen del último como "destacado"
                if (holders[0].image_url) {
                    embed.setThumbnail(holders[0].image_url);
                }

                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Error en /cardholder:', error);
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: '❌ Error interno del sistema.', ephemeral: true });
            } else {
                await interaction.editReply('❌ Ocurrió un error al procesar tu solicitud.');
            }
        }
    }
};
