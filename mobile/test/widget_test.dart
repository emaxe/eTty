// Дымовой тест приложения — переживает замену конкретных экранов (задачи #21/#22 и далее):
// проверяет только то, что `EttyApp` строится и рендерит `MaterialApp` без исключений, не
// содержимое конкретного экрана (оно меняется по ходу разработки Блока 4).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/main.dart';

void main() {
  testWidgets('EttyApp строится и рендерит MaterialApp без исключений', (
    tester,
  ) async {
    await tester.pumpWidget(const ProviderScope(child: EttyApp()));
    await tester.pump();

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
