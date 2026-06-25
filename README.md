# WiFi-JEPA

Project page for **WiFi-JEPA: Self-supervised Learning for WiFi-CSI 3D Human Pose Estimation** (ECCV 2026).

🌐 **Live page:** https://wifi-jepa.github.io/

## Authors

Doeon Kim, Jungyoon Lee, Seongsin Kim, Seong-heum Kim
Soongsil University, Seoul, South Korea

## Abstract

WiFi Channel State Information (CSI) enables privacy-preserving human pose sensing
through walls and in darkness, but existing WiFi-based pose estimators often fail
under domain shifts and rely on costly camera-based annotation pipelines. WiFi-JEPA
is a self-supervised framework that learns CSI-native representations by predicting
masked latent embeddings, with CSI-specific tokenization and link masking, a
ray-tracing CSI simulation pipeline for pre-training, and state-of-the-art results on
Person-in-WiFi-3D (76.8 mm single-person, 93.5 mm multi-person MPJPE).

Code and dataset will be released.

## Citation

```bibtex
@inproceedings{kim2026wifijepa,
  title     = {WiFi-JEPA: Self-supervised Learning for WiFi-CSI 3D Human Pose Estimation},
  author    = {Kim, Doeon and Lee, Jungyoon and Kim, Seongsin and Kim, Seong-heum},
  booktitle = {Proceedings of the European Conference on Computer Vision (ECCV)},
  year      = {2026}
}
```

## Acknowledgements

This page is built with the [Academic Project Page Template](https://github.com/eliahuhorwitz/Academic-project-page-template),
adapted from the [Nerfies](https://nerfies.github.io) project page, and is licensed
under [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/).
