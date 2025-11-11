import { fetchApi } from "@libs/fetch";
import { Plugin } from "@typings/plugin";
import { NovelStatus } from "@libs/novelStatus";
import * as cheerio from "cheerio";

class NovaPlugin implements Plugin.PluginBase {
    id = 'nova';
    name = 'NOVA';
    icon = 'src/en/kdtnovels/icon.png';
    site = 'https://novelasligeras.net';
    version = '1.0.0';
    
    // Regex para parsear títulos de capítulos
    private readonly CHAPTER_REGEX = /(Parte \d+)[\s\-:.\–]+(.+?):\s*(.+)/;
    
    // Método para obtener novelas populares
    async popularNovels(
        pageNo: number,
        options: Plugin.PopularNovelsOptions
    ): Promise<Plugin.NovelItem[]> {
        const url = `${this.site}/index.php/page/${pageNo}/?post_type=product&orderby=popularity`;
        const body = await fetchApi(url).then(res => res.text());
        const $ = cheerio.load(body);
        
        const novels: Plugin.NovelItem[] = [];
        
        $('div.wf-cell').each((i, element) => {
            const $el = $(element);
            const $img = $el.find('img');
            const $link = $el.find('h4.entry-title a');
            
            const path = $link.attr('href')?.replace(this.site, '') || '';
            const name = $link.text().trim();
            const cover = $img.attr('data-src') || $img.attr('src') || '';
            
            if (name && path) {
                novels.push({ name, path, cover });
            }
        });
        
        return novels;
    }
    
    // Método para buscar novelas
    async searchNovels(
        searchTerm: string,
        pageNo: number
    ): Promise<Plugin.NovelItem[]> {
        const encodedTerm = encodeURIComponent(searchTerm);
        const url = `${this.site}/index.php/page/${pageNo}/?s=${encodedTerm}&post_type=product&orderby=relevance`;
        const body = await fetchApi(url).then(res => res.text());
        const $ = cheerio.load(body);
        
        const novels: Plugin.NovelItem[] = [];
        
        $('div.wf-cell').each((i, element) => {
            const $el = $(element);
            const $img = $el.find('img');
            const $link = $el.find('h4.entry-title a');
            
            const path = $link.attr('href')?.replace(this.site, '') || '';
            const name = $link.text().trim();
            const cover = $img.attr('data-src') || $img.attr('src') || '';
            
            if (name && path) {
                novels.push({ name, path, cover });
            }
        });
        
        return novels;
    }
    
    // Método para obtener detalles de una novela
    async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
        const url = `${this.site}${novelPath}`;
        const body = await fetchApi(url).then(res => res.text());
        const $ = cheerio.load(body);
        
        // Extraer información básica
        const name = $('h1').first().text().trim();
        const $coverImg = $('.woocommerce-product-gallery img').first();
        const cover = $coverImg.attr('data-src') || $coverImg.attr('src') || '';
        
        // Extraer autor, artista y género
        const author = $('.woocommerce-product-attributes-item--attribute_pa_escritor td')
            .text().trim() || 'Desconocido';
        const artist = $('.woocommerce-product-attributes-item--attribute_pa_ilustrador td')
            .text().trim() || '';
        
        // Extraer etiquetas y géneros
        const labels = $('.woocommerce-product-gallery .berocket_better_labels b')
            .map((i, el) => $(el).text().trim())
            .get()
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 2);
        
        const genres = $('.product_meta .posted_in a')
            .map((i, el) => $(el).text().trim())
            .get()
            .join(', ');
        
        // Construir resumen
        const shortDescription = $('.woocommerce-product-details__short-description').text().trim();
        const labelsText = labels.length > 0 ? labels.map(l => `[${l}]`).join(' ') + '\n\n' : '';
        const summary = (labelsText + shortDescription).trim();
        
        // Determinar estado
        const statusText = $('.woocommerce-product-attributes-item--attribute_pa_estado td')
            .text().trim().toLowerCase();
        let status = NovelStatus.Unknown;
        if (statusText.includes('en curso') || statusText.includes('ongoing')) {
            status = NovelStatus.Ongoing;
        } else if (statusText.includes('completado') || statusText.includes('completed')) {
            status = NovelStatus.Completed;
        }
        
        // Extraer capítulos
        const chapters: Plugin.ChapterItem[] = [];
        
        $('.vc_row div.vc_column-inner > div.wpb_wrapper .wpb_tab a').each((index, element) => {
            const $el = $(element);
            const chapterPath = $el.attr('href')?.replace(this.site, '') || '';
            const chapterText = $el.text().trim();
            
            // Buscar el volumen más cercano
            let volume = '';
            const $volumeTitle = $el.parents().find('.dt-fancy-title').filter((i, el) => {
                return $(el).text().startsWith('Volumen');
            }).first();
            
            if ($volumeTitle.length > 0) {
                volume = $volumeTitle.text().trim();
            }
            
            // Parsear el nombre del capítulo
            let chapterName = chapterText;
            const match = this.CHAPTER_REGEX.exec(chapterText);
            
            if (match) {
                const [, part, number, title] = match;
                chapterName = volume 
                    ? `${volume} - ${number} - ${part}: ${title}`
                    : `${number} - ${part}: ${title}`;
            } else if (volume) {
                chapterName = `${volume} - ${chapterText}`;
            }
            
            if (chapterPath) {
                chapters.push({
                    name: chapterName,
                    path: chapterPath,
                    releaseTime: '',
                    chapterNumber: index + 1
                });
            }
        });
        
        // LNReader muestra los capítulos en orden inverso por defecto
        // así que los invertimos aquí para mantener el orden correcto
        chapters.reverse();
        
        const novel: Plugin.SourceNovel = {
            path: novelPath,
            name,
            cover,
            summary,
            author,
            artist,
            genres,
            status,
            chapters
        };
        
        return novel;
    }
    
    // Método para obtener contenido del capítulo
    async parseChapter(chapterPath: string): Promise<string> {
        const url = `${this.site}${chapterPath}`;
        const body = await fetchApi(url).then(res => res.text());
        const $ = cheerio.load(body);
        
        // Determinar el selector correcto basado en el contenido
        let contentSelector = '.wpb_text_column.wpb_content_element > .wpb_wrapper';
        
        if (body.includes('Nadie entra sin permiso en la Gran Tumba de Nazarick')) {
            contentSelector = '#content';
        }
        
        const $content = $(contentSelector).first();
        
        // Remover elementos no deseados
        $content.find('h1, center, img.aligncenter.size-large').remove();
        
        // Si no se encontró contenido, usar el body completo
        let chapterContent = $content.html()?.trim() || $('body').html()?.trim() || '';
        
        // Limpiar scripts, estilos y otros elementos innecesarios
        const $clean = cheerio.load(chapterContent);
        $clean('script, style, iframe, .ads, .advertisement').remove();
        
        return $clean.html() || chapterContent;
    }
}

export default new NovaPlugin();
