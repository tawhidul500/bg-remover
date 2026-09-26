<?php
/**
 * Plugin Name:       Cutout Studio – AI Service
 * Description:       Adds an "AI Service" menu item and a page running the Cutout Studio background remover & image editor inside your existing theme (header, footer and styling are your site's).
 * Version:           1.1.0
 * Author:            Clipping World
 * License:           GPL-2.0-or-later
 * Text Domain:       cutout-studio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const CUTOUT_STUDIO_OPTION   = 'cutout_studio_settings';
const CUTOUT_STUDIO_PAGE_OPT = 'cutout_studio_page_id';

function cutout_studio_defaults() {
	return array(
		'app_url'     => 'https://tools.clippingworld.com',
		'min_height'  => 760,
		'menu_label'  => 'AI Service',
		'auto_menu'   => 1,   // add the item to nav menus automatically
		'menu_style'  => 'link', // 'link' = same as your other menu items, 'button' = accent pill
		'page_slug'   => 'ai-service',
	);
}

function cutout_studio_settings() {
	return wp_parse_args( get_option( CUTOUT_STUDIO_OPTION, array() ), cutout_studio_defaults() );
}

function cutout_studio_page_url() {
	$id = (int) get_option( CUTOUT_STUDIO_PAGE_OPT );
	return ( $id && 'publish' === get_post_status( $id ) ) ? get_permalink( $id ) : '';
}

/* ---------------------------------------------------------------------------
 * Activation: create the "AI Service" page containing the shortcode.
 * The page uses your active theme, so your header, footer and styles apply.
 * ------------------------------------------------------------------------- */
register_activation_hook( __FILE__, function () {
	$s  = cutout_studio_settings();
	$id = (int) get_option( CUTOUT_STUDIO_PAGE_OPT );
	if ( $id && 'trash' !== get_post_status( $id ) ) {
		return;
	}
	$existing = get_page_by_path( $s['page_slug'] );
	if ( $existing ) {
		update_option( CUTOUT_STUDIO_PAGE_OPT, $existing->ID );
		return;
	}
	$new = wp_insert_post( array(
		'post_title'   => 'AI Service – Background Remover & Image Editor',
		'post_name'    => $s['page_slug'],
		'post_status'  => 'publish',
		'post_type'    => 'page',
		'post_content' => '[cutout_studio]',
	) );
	if ( $new && ! is_wp_error( $new ) ) {
		update_option( CUTOUT_STUDIO_PAGE_OPT, $new );
	}
} );

/* ---------------------------------------------------------------------------
 * Settings screen
 * ------------------------------------------------------------------------- */
add_action( 'admin_menu', function () {
	add_options_page( 'Cutout Studio', 'Cutout Studio', 'manage_options', 'cutout-studio', 'cutout_studio_settings_page' );
} );

add_action( 'admin_init', function () {
	register_setting( 'cutout_studio', CUTOUT_STUDIO_OPTION, array(
		'sanitize_callback' => function ( $in ) {
			$d = cutout_studio_defaults();
			return array(
				'app_url'    => isset( $in['app_url'] ) ? esc_url_raw( untrailingslashit( trim( $in['app_url'] ) ), array( 'https', 'http' ) ) : $d['app_url'],
				'min_height' => isset( $in['min_height'] ) ? max( 480, min( 2000, absint( $in['min_height'] ) ) ) : $d['min_height'],
				'menu_label' => isset( $in['menu_label'] ) ? sanitize_text_field( $in['menu_label'] ) : $d['menu_label'],
				'auto_menu'  => empty( $in['auto_menu'] ) ? 0 : 1,
				'menu_style' => ( isset( $in['menu_style'] ) && 'button' === $in['menu_style'] ) ? 'button' : 'link',
				'page_slug'  => isset( $in['page_slug'] ) ? sanitize_title( $in['page_slug'] ) : $d['page_slug'],
			);
		},
	) );
} );

function cutout_studio_settings_page() {
	$s   = cutout_studio_settings();
	$url = cutout_studio_page_url();
	?>
	<div class="wrap">
		<h1>Cutout Studio</h1>
		<p>The tool runs inside a page of your site, so your theme's header, footer and styling stay exactly as they are.</p>
		<?php if ( $url ) : ?>
			<p><strong>Your page:</strong> <a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $url ); ?></a></p>
		<?php else : ?>
			<p><em>No page found. Create a page and add the shortcode <code>[cutout_studio]</code>.</em></p>
		<?php endif; ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'cutout_studio' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="cs_url">App URL</label></th>
					<td>
						<input id="cs_url" class="regular-text" type="url" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[app_url]" value="<?php echo esc_attr( $s['app_url'] ); ?>" required>
						<p class="description">Where the Cutout Studio app is deployed, e.g. <code>https://tools.clippingworld.com</code>.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="cs_label">Menu label</label></th>
					<td><input id="cs_label" class="regular-text" type="text" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[menu_label]" value="<?php echo esc_attr( $s['menu_label'] ); ?>"></td>
				</tr>
				<tr>
					<th scope="row">Navigation</th>
					<td>
						<label><input type="checkbox" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[auto_menu]" value="1" <?php checked( $s['auto_menu'], 1 ); ?>> Add the item to my menus automatically</label>
						<p class="description">Leave this off if you prefer to add it yourself under <strong>Appearance → Menus</strong>.</p>
						<p style="margin-top:10px">
							<label><input type="radio" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[menu_style]" value="link" <?php checked( $s['menu_style'], 'link' ); ?>> Same look as my other menu items</label><br>
							<label><input type="radio" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[menu_style]" value="button" <?php checked( $s['menu_style'], 'button' ); ?>> Highlighted button (like “Free Trial”)</label>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="cs_h">Minimum height (px)</label></th>
					<td><input id="cs_h" type="number" min="480" max="2000" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[min_height]" value="<?php echo esc_attr( $s['min_height'] ); ?>"></td>
				</tr>
				<tr>
					<th scope="row"><label for="cs_slug">Page slug</label></th>
					<td><input id="cs_slug" class="regular-text" type="text" name="<?php echo esc_attr( CUTOUT_STUDIO_OPTION ); ?>[page_slug]" value="<?php echo esc_attr( $s['page_slug'] ); ?>"></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

/* ---------------------------------------------------------------------------
 * Add the "AI Service" item to nav menus.
 * It's injected as a normal <li><a> so it inherits your theme's menu styling.
 * ------------------------------------------------------------------------- */
add_filter( 'wp_nav_menu_items', function ( $items, $args ) {
	$s = cutout_studio_settings();
	if ( empty( $s['auto_menu'] ) ) {
		return $items;
	}
	$url = cutout_studio_page_url();
	if ( ! $url ) {
		return $items;
	}
	// Only the primary/main menu, so it isn't repeated in footer or mobile-only menus.
	$loc = isset( $args->theme_location ) ? (string) $args->theme_location : '';
	if ( $loc && ! preg_match( '/primary|main|header/i', $loc ) ) {
		return $items;
	}
	if ( false !== strpos( $items, 'cutout-studio-menu-item' ) ) {
		return $items;
	}
	$current = ( get_the_ID() === (int) get_option( CUTOUT_STUDIO_PAGE_OPT ) );
	$classes = array( 'menu-item', 'menu-item-type-post_type', 'menu-item-object-page', 'cutout-studio-menu-item' );
	if ( $current ) {
		$classes[] = 'current-menu-item';
		$classes[] = 'current_page_item';
	}
	if ( 'button' === $s['menu_style'] ) {
		$classes[] = 'cs-menu-button';
	}
	$items .= sprintf(
		'<li class="%1$s"><a href="%2$s"%3$s>%4$s</a></li>',
		esc_attr( implode( ' ', $classes ) ),
		esc_url( $url ),
		$current ? ' aria-current="page"' : '',
		esc_html( $s['menu_label'] )
	);
	return $items;
}, 10, 2 );

/* Small stylesheet only needed for the optional highlighted button. */
add_action( 'wp_enqueue_scripts', function () {
	$s = cutout_studio_settings();
	if ( ! empty( $s['auto_menu'] ) && 'button' === $s['menu_style'] ) {
		wp_register_style( 'cutout-studio-menu', false, array(), '1.1.0' );
		wp_enqueue_style( 'cutout-studio-menu' );
		wp_add_inline_style( 'cutout-studio-menu', '
			.cs-menu-button > a{background:#ff872a;color:#fff !important;border-radius:999px;padding:10px 22px !important;font-weight:600;display:inline-block;line-height:1;}
			.cs-menu-button > a:hover{background:#e8721a;color:#fff !important;}
		' );
	}
} );

/* ---------------------------------------------------------------------------
 * Shortcode: renders the editor inside your themed page.
 * ------------------------------------------------------------------------- */
add_shortcode( 'cutout_studio', function ( $atts ) {
	$s    = cutout_studio_settings();
	$atts = shortcode_atts( array(
		'intro'      => 'yes',
		'title'      => 'AI Background Remover & Image Editor',
		'subtitle'   => 'Upload a photo, remove the background automatically, refine the edges, add a new background, adjust colours, resize, add a shadow, compress and download a PNG, JPG or WebP. Everything runs in your browser.',
		'min_height' => $s['min_height'],
	), $atts, 'cutout_studio' );

	wp_enqueue_style( 'cutout-studio', plugins_url( 'cutout-studio.css', __FILE__ ), array(), '1.1.0' );

	$src = esc_url( $s['app_url'] . '/embed' );
	$h   = max( 480, absint( $atts['min_height'] ) );
	ob_start();
	?>
	<section class="cs-wrap">
		<?php if ( 'yes' === $atts['intro'] ) : ?>
			<div class="cs-hero">
				<h1 class="cs-title"><?php echo esc_html( $atts['title'] ); ?></h1>
				<p class="cs-sub"><?php echo esc_html( $atts['subtitle'] ); ?></p>
			</div>
		<?php endif; ?>
		<div class="cs-frame" style="--cs-min-h: <?php echo (int) $h; ?>px">
			<iframe
				src="<?php echo $src; ?>"
				title="Cutout Studio background remover and image editor"
				allow="clipboard-read; clipboard-write; fullscreen"
				referrerpolicy="strict-origin-when-cross-origin"></iframe>
		</div>
		<p class="cs-note">
			Images are processed on your device and saved only in this browser — they are not uploaded to a server.
			<a href="<?php echo esc_url( $s['app_url'] . '/editor' ); ?>" target="_blank" rel="noopener">Open full screen ↗</a>
		</p>
	</section>
	<?php
	return ob_get_clean();
} );
