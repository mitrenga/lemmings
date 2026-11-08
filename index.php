<?php
  require_once 'config/config.php';
  $appName = 'Lemmings';
  $appDescription = 'Faithful browser remake of Lemmings (DMA Design / Psygnosis, DOS 1991) on the svision library: VGA 320x200 in 16 colours, the original data, the original physics.';
  $appPrefix = 'lem';
  $appNoscript =
    '<h1>'.$appName.'</h1>'.
    '<p>Lemmings is the 1991 puzzle game by DMA Design: a crowd of small green-haired creatures walks off a cliff '.
    'unless you give a few of them the right skill at the right moment. This is a faithful remake of the DOS version '.
    'that runs in your web browser. Please enable JavaScript to start the game.</p>';
  require_once 'app/svision/php/main.php';
